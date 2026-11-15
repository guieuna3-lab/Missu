import { createHash } from 'node:crypto';
import {
  itemSearch,
  brandNameFilter,
  likeLiteral,
  matchesName,
  matchesPlace,
  type ItemSearch,
} from './item-search';
import {
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { fail } from '../common/http';
import { ExternalHttpService } from '../integrations/external-http.service';
import { NearbyDto } from './nearby.dto';
import {
  clean,
  custodianPhone,
  distance,
  governmentItem,
  koreaDay,
  sinceFound as since,
  schoolDetail,
  schoolList,
  schoolArticle,
  policeSite,
  policePage,
  portalDetail,
  roadKey,
  schoolPage,
  type Batch,
  type InstitutionItem,
  type Point,
  type Source,
} from './institution-records';

const government = {
  경찰: { base: 'LosfundInfoInqireService', prefix: 'getLosfund' },
  포털기관: { base: 'LosPtfundInfoInqireService', prefix: 'getPtLosfund' },
} as const;
type Provider = keyof typeof government;
class DailyPortalLimit extends Error {}
function nextPortalDay() {
  const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return Date.parse(date + 'T00:00:00+09:00') + 86400000;
}
type NearbyCount = {
  status: 'counting' | 'complete' | 'partial' | 'unavailable';
  total: number | null;
  incomplete: Source[];
};
type NearbyCountJob = { result: NearbyCount };
type Custodian = Point & { name: string; address: string; source: Source };
type Located = InstitutionItem & {
  foundLocation: Point & { label: string };
  distanceM: number;
};
type Result<T> = { items: T[]; notices: string[]; unavailableSource?: Source };
// 기관마다 원본 페이지와 아직 상세 확인하지 않은 후보 위치가 다릅니다.
type Position = [page: number, offset: number] | null;
type PageBatch = Batch & { next?: Position; loadFailed?: boolean };
type CountProgress = {
  status: 'counting' | 'complete' | 'unavailable';
  total: number | null;
  confirmedPortal?: number;
  confirmedTotal?: number;
  policeIncluded?: boolean;
  checkedAt?: string;
  progress?: {
    stage: 'listing' | 'checking';
    checked: number;
    candidates: number;
  };
};
type CountScan = {
  ids: Set<string>;
  policeIds: Set<string>;
  policeAvailable: boolean;
  incomplete?: boolean;
  retryPoliceAt?: number;
  baseExpires?: number;
  cursor?: string;
  expires: number;
  result: CountProgress;
  running?: Promise<CountProgress>;
};
type KakaoPlace = {
  place_name: string;
  road_address_name: string;
  x: string;
  y: string;
  category_group_code?: string;
};
// 카카오는 '한성대입구역 4호선', 포털은 '한성대입구역(4호선)'처럼 표기합니다.
const stationKey = (name: string) => clean(name).replace(/[()]/g, '');
async function readBatches<T>(jobs: (() => Promise<T>)[], concurrency: number) {
  const results: PromiseSettledResult<T>[] = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await jobs[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  // 느린 요청 하나가 다음 묶음을 막지 않게, 빈 자리가 생길 때마다 이어서 조회합니다.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
  return results;
}
// 페이지 0은 저장된 결과, 이 표식은 저장 목록을 본 후 돌아갈 원본 첫 페이지입니다.
const liveFirstOffset = 1000;
const walletSnapshot = '지갑:6개월';
const sourceList: ('한성대' | Provider)[] = ['한성대', '경찰', '포털기관'];
function combine<T extends InstitutionItem>(parts: Result<T>[]): Result<T> {
  return {
    items: [
      ...new Map(
        parts.flatMap((p) => p.items).map((item) => [item.id, item]),
      ).values(),
    ],
    notices: [...new Set(parts.flatMap((p) => p.notices))],
  };
}

@Injectable()
export class InstitutionItemsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  constructor(
    private readonly http: ExternalHttpService,
    @Optional() private readonly db?: DatabaseService,
  ) {}
  private walletWorker?: Promise<void>;
  private stopping = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(InstitutionItemsService.name);
  onApplicationBootstrap() {
    if (!this.db || !process.env.DATA_GO_KR_SERVICE_KEY) return;
    const wake = () => this.startWalletWorker();
    this.timer = setInterval(wake, 60000);
    this.timer.unref();
    wake();
  }
  private startWalletWorker() {
    const db = this.db;
    if (!db || this.stopping || this.walletWorker) return;
    this.walletWorker = (async () => {
      const row = await db.agencyCountSnapshot.upsert({
        where: { query: walletSnapshot },
        create: { query: walletSnapshot },
        update: {},
      });
      if (row.retryAt.getTime() <= Date.now())
        await this.updateWalletSnapshot(db);
    })()
      .catch(() => {
        this.logger.warn('전국 습득물 집계를 잠시 후 다시 시도합니다.');
      })
      .finally(() => {
        this.walletWorker = undefined;
      });
  }
  onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
  }
  private readonly exhaustedOperations = new Map<string, number>();
  private readonly counts = new Map<string, CountScan>();
  // 동일 기관 상세 요청을 합치고, 만료 시 원본 보관 상태를 다시 읽습니다.
  private cache = new Map<
    string,
    { until: number; observedAt: Date; value: Promise<string> }
  >();
  private async text(
    key: string,
    url: URL,
    headers?: Record<string, string>,
    body?: string,
  ) {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now())
      return { body: await cached.value, observedAt: cached.observedAt };
    if (this.cache.size >= 400)
      this.cache.delete(this.cache.keys().next().value!);
    const observedAt = new Date();
    const value = this.http
      .request(url.toString(), {
        headers,
        ...(body && { method: 'POST', body }),
        ...(['apis.data.go.kr', 'minwon24.police.go.kr'].includes(
          url.hostname,
        ) && {
          signal: AbortSignal.timeout(9500),
        }),
      })
      .then((r) => r.text());
    this.cache.set(key, { until: Date.now() + 120000, observedAt, value });
    void value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return { body: await value, observedAt };
  }
  private async school(q: string, days: string, page = 1) {
    const url = new URL(schoolList);
    url.searchParams.set('page', String(page));
    const terms = itemSearch(q);
    if (q && terms.terms.length === 1 && terms.terms[0].length === 1) {
      url.searchParams.set('findType', 'sj');
      url.searchParams.set('findWord', q);
    }
    if (since(days)) url.searchParams.set('rgsBgndeStr', since(days));
    const cutoff = since(days),
      today = koreaDay();
    const batch = schoolPage(
      (await this.text(url.href, url)).body,
      page,
      cutoff,
    );
    const results = await readBatches(
      batch.items
        .filter((i) => i.date >= cutoff && matchesName(terms, i.name))
        .map((item) => async () => {
          const record = schoolDetail(
            (await this.text(item.url, new URL(item.url))).body,
            item.reference,
          );
          return record && record.date >= cutoff && record.date <= today
            ? record
            : null;
        }),
      4,
    );
    const items = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value ? [r.value] : [],
    );
    return {
      items,
      limited: batch.limited,
      loadFailed: results.some((r) => r.status === 'rejected'),
    };
  }
  private async portalRecord(atcId: string, fdSn: string) {
    const url = new URL(
      'https://minwon24.police.go.kr/cvlcpt/selectFindListDetail.do',
    );
    url.search = new URLSearchParams({
      cvlcptId: 'MW-201',
      pkupCmdtyMngId: atcId,
      sortSn: fdSn,
    }).toString();
    const res = await this.text(url.href, url);
    const row = portalDetail(res.body, atcId, fdSn);
    return {
      item: await this.verifiedItem(
        row,
        atcId.startsWith('V') ? '포털기관' : '경찰',
        res.observedAt,
      ),
      observedAt: res.observedAt,
    };
  }
  private async publicIndex(
    query: string,
    storage: string,
    days: string,
    page: number,
  ) {
    const url = new URL('https://minwon24.police.go.kr/wisenut/search.do');
    const start = since(days),
      end = koreaDay();
    const body = JSON.stringify({
      query,
      searchFields: ['_ALL_'],
      resultFields: [
        'PKUP_CMDTY_MNG_ID',
        'SORT_SN',
        'KPNG_PLC_NM',
        'SGG_NM',
        'ITEM_CN',
        'PKUP_CMDTY_LCLSF_NM',
        'PKUP_CMDTY_MCLSF_NM',
      ],
      collections: ['FOUND'],
      pageStart: page,
      pageCount: 50,
      orderBys: ['DATE/DESC'],
      subQueries: {
        MODE: 'DETAIL',
        SNIPPET_SIZE: '200',
        HL_TERM: '',
        FOUND_FILTER_QUERY: '',
        FOUND_COLLECTION_QUERY: storage
          ? '<KPNG_PLC_NM:contains:' + storage + '>'
          : '',
        START_DATE: start.replaceAll('-', '') + '000000',
        END_DATE: end.replaceAll('-', '') + '235959',
      },
    });
    const response = await this.text(
      'portal-index:' + body,
      url,
      { 'Content-Type': 'application/json' },
      body,
    );
    const group = (
      JSON.parse(response.body) as {
        result: {
          outputs: {
            FOUND: {
              totalCount: number | string;
              documents: { fields: Record<string, string> }[];
            };
          };
        };
      }
    ).result.outputs.FOUND;
    const total = Number(group.totalCount);
    if (
      group.totalCount == null ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      !Array.isArray(group.documents)
    )
      throw Error('Unknown public list');

    return { group, total };
  }
  // 공개 목록의 습득 지역과 상세의 실제 보관 상태를 대조합니다. 접수 이후 이관된 물품도 찾습니다.
  private async publicPlace(search: ItemSearch, days: string, page: number) {
    const station = search.place.match(/^(.+역)\s*(?:\(?\d+호선\)?)$/u)?.[1];
    const { group, total } = await this.publicIndex(
      station || search.place,
      '',
      days,
      page,
    );
    const jobs = group.documents.flatMap(({ fields }) => {
      const field = (k: string) =>
        String(fields[k] ?? '').replace(/<(?:HS|HE)>/g, '');
      const id = field('PKUP_CMDTY_MNG_ID'),
        sn = field('SORT_SN');
      if (!/^[A-Z0-9]{2,32}$/.test(id) || !/^\d{1,6}$/.test(sn))
        throw Error('Invalid public item');
      const kinds = [
        field('PKUP_CMDTY_LCLSF_NM'),
        field('PKUP_CMDTY_MCLSF_NM'),
      ];
      if (!matchesName(search, field('ITEM_CN'), ...kinds)) return [];
      return [
        async () => {
          const { item, observedAt } = await this.portalRecord(id, sn);
          if (
            item &&
            item.date >= since(days) &&
            item.date <= koreaDay() &&
            matchesName(search, item.name, ...kinds) &&
            matchesPlace(
              search.place,
              item.storage,
              item.foundPlace,
              field('SGG_NM'),
            )
          )
            return { ...item, lastVerifiedOn: koreaDay(observedAt.getTime()) };
        },
      ];
    });
    const checked = await readBatches(jobs, 4);
    if (!group.documents.length && (page - 1) * 50 < total)
      throw Error('Incomplete public list');
    return {
      items: checked.flatMap((r) =>
        r.status === 'fulfilled' && r.value ? [r.value] : [],
      ),
      loadFailed: checked.some((r) => r.status === 'rejected'),
      more: page * 50 < total,
    };
  }
  // 포털 공개 검색과 OpenAPI의 게시 시점·목록이 다를 수 있어 관리번호로 합칩니다.
  private async publicStation(site: Custodian, days: string) {
    const storage = site.name.replace(/^(.+역)\s+(.+)$/u, '$1($2)');
    if (/[<>:\r\n]/.test(storage)) throw Error('Invalid place');
    const seen = new Set<string>();
    const records = new Map<string, InstitutionItem | undefined>();
    let failed = false;
    for (let page = 1; ; page++) {
      try {
        const { group, total } = await this.publicIndex(
          '',
          storage,
          days,
          page,
        );
        const before = seen.size;
        const jobs = group.documents.flatMap(({ fields }) => {
          const atcId = fields.PKUP_CMDTY_MNG_ID,
            fdSn = String(fields.SORT_SN);
          if (!/^[A-Z0-9]{2,32}$/.test(atcId) || !/^\d{1,6}$/.test(fdSn)) {
            failed = true;
            return [];
          }
          const id = 'lost112:' + atcId + ':' + fdSn;
          if (seen.has(id)) return [];
          seen.add(id);
          if (
            !atcId.startsWith('V') ||
            stationKey(
              (fields.KPNG_PLC_NM || '').replace(/<(?:HS|HE)>/g, ''),
            ) !== stationKey(storage)
          )
            return [];
          return [
            async () => {
              const { item } = await this.portalRecord(atcId, fdSn);
              records.set(
                id,
                item && stationKey(item.storage) === stationKey(storage)
                  ? item
                  : undefined,
              );
            },
          ];
        });
        const checked = await readBatches(jobs, 3);
        failed ||= checked.some((r) => r.status === 'rejected');
        if (seen.size >= total) break;
        if (seen.size === before || group.documents.length === 0)
          throw Error('Incomplete public list');
      } catch {
        failed = true;
        break;
      }
    }
    return { records, failed };
  }
  async detail(id: string) {
    const hs = /^hansung:(\d{1,12})$/.exec(id);
    const missing = () =>
      fail(
        404,
        'RESOURCE_NOT_FOUND',
        '반환되었거나 조회할 수 없는 물품이에요.',
      );
    if (hs) {
      const url = schoolArticle(hs[1]);
      const item = schoolDetail(
        (await this.text(url, new URL(url))).body,
        hs[1],
      );
      return item ?? missing();
    }
    const m = /^lost112:([A-Z0-9]{2,32}):(\d{1,6})$/.exec(id);
    if (!m) return missing();
    const saved = await this.db?.verifiedPortalItem.findUnique({
      where: { id },
    });
    if (saved && !saved.stored) return missing();
    const source = m[1].startsWith('V') || saved ? '포털기관' : '경찰';
    const result = await this.list(source, 'DetailInfo', {
      ATC_ID: m[1],
      FD_SN: m[2],
    }).catch(() => null);
    const row = result?.records.find(
      (r) => r.atcId === m[1] && r.fdSn === m[2],
    );
    if (!result || !row?.csteSteNm) {
      {
        const publicRecord = await this.portalRecord(m[1], m[2]).catch(
          () => null,
        );
        if (publicRecord)
          return publicRecord.item
            ? {
                ...publicRecord.item,
                lastVerifiedOn: koreaDay(publicRecord.observedAt.getTime()),
              }
            : missing();
      }
      if (saved) return this.savedItem(saved);
      if (!result)
        return fail(
          503,
          'EXTERNAL_UNAVAILABLE',
          '기관 상세를 불러올 수 없어요. 잠시 후 다시 확인해 주세요.',
        );
      return missing();
    }
    const current = await this.verifiedItem(row, source, result.observedAt);
    return current
      ? { ...current, lastVerifiedOn: koreaDay(result.observedAt.getTime()) }
      : missing();
  }
  private savedItem(r: {
    id: string;
    name: string;
    storage: string;
    source: string;
    category: string;
    day: string;
    checkedAt: Date;
    phone?: string | null;
  }): InstitutionItem {
    return {
      id: r.id,
      name: r.name,
      storage: r.storage,
      source: r.source === '지하철' ? '지하철' : '포털기관',
      category: r.category,
      date: r.day,
      dateLabel: '습득일',
      url: policeSite,
      reference: r.id.slice(8).replace(':', ' / '),
      lastVerifiedOn: koreaDay(r.checkedAt.getTime()),
      phone: custodianPhone(r.storage, r.phone),
    };
  }
  async preview(q: string, place: string, days: string) {
    const result = await this.part('한성대', () => this.school(q, days));
    return {
      items: result.items
        .filter(
          (i) =>
            i.date >= since(days) &&
            (!place || clean(i.storage).includes(clean(place))),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    };
  }
  async portalRegistrations(q: string, place: string) {
    // 역·호선별 보조 목록은 겹칩니다. 총건수는 조건에 맞는 원본 목록 한 곳에서만 읽습니다.
    const params: Record<string, string> = {
      numOfRows: '40',
      pageNo: '1',
      PRDT_NM: q,
    };
    if (place)
      params.DEP_PLACE = place.replace(
        /^(.+역)\s+([^()]+(?:호선|선))$/u,
        '$1($2)',
      );
    try {
      return (await this.list('포털기관', 'InfoAccTpNmCstdyPlace', params))
        .total;
    } catch {
      return null;
    }
  }
  private async list(
    source: Provider,
    operation: string,
    params: Record<string, string>,
  ) {
    const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
    if (!key) throw Error('Agency access pending');
    const { base, prefix } = government[source];
    const url = new URL(
      'https://apis.data.go.kr/1320000/' + base + '/' + prefix + operation,
    );
    url.search = new URLSearchParams(params).toString();
    const cacheId = url.href;
    url.searchParams.set('ServiceKey', key);
    const method = source + '/' + operation;
    if ((this.exhaustedOperations.get(method) ?? 0) > Date.now())
      throw new DailyPortalLimit();
    const { body: xml, observedAt } = await this.text(cacheId, url);
    if (
      /<(?:returnReasonCode|resultCode)>\s*22\s*<\//u.test(xml) ||
      xml.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR')
    ) {
      this.exhaustedOperations.set(method, nextPortalDay());
      this.cache.delete(cacheId);
      throw new DailyPortalLimit();
    }
    return { ...policePage(xml), observedAt };
  }
  private async verifiedItem(
    row: Record<string, string>,
    source: Provider,
    observedAt: Date,
    db: Pick<Prisma.TransactionClient, '$executeRaw'> | undefined = this.db,
  ) {
    const item = governmentItem(row, source);
    if (source === '포털기관' && db && row.csteSteNm?.trim()) {
      const stored = clean(row.csteSteNm) === '보관중';
      if (stored && !item) throw Error('Incomplete custody details');
      const id = 'lost112:' + row.atcId + ':' + row.fdSn;
      // 늦게 도착한 이전 보관 응답이 더 최근의 반환 확인을 덮어쓰지 않게 합니다.
      await db.$executeRaw`INSERT INTO verified_portal_items AS old
        (id,name,source,storage,place_key,day,category,stored,checked_at,phone)
        VALUES (${id},${item?.name ?? ''},${item?.source ?? source},${item?.storage ?? ''},
          ${stationKey(item?.storage ?? '')},${item?.date ?? ''},${item?.category ?? ''},${stored},${observedAt},${item?.phone ?? null})
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,source=EXCLUDED.source,storage=EXCLUDED.storage,
        place_key=EXCLUDED.place_key,day=EXCLUDED.day,category=EXCLUDED.category,stored=EXCLUDED.stored,checked_at=EXCLUDED.checked_at,phone=EXCLUDED.phone
        WHERE old.checked_at < EXCLUDED.checked_at OR (old.checked_at = EXCLUDED.checked_at AND NOT EXCLUDED.stored)`;
    }
    return item;
  }
  private async records(
    source: Provider,
    q: string,
    place: string,
    days: string,
    site?: Custodian,
    recent = false,
    position: Exclude<Position, null> = [1, 0],
    strict = false,
    supplementWallet = false,
  ): Promise<PageBatch> {
    const [pageNo, offset] = position;
    const station =
      source === '포털기관' && site?.name.match(/^(.+역)\s+(.+)$/u);
    // 다른 도시의 동명·동일 호선 역은 기관 이름만으로 지도에 배치할 수 없습니다.
    if (station && site && !(await this.uniqueStation(site)))
      return { items: [], limited: true };
    const road = site && roadKey(site.address);
    if (site && !station && !road) return { items: [], limited: true };
    const filters: Record<string, string> = {
      numOfRows: '40',
      pageNo: String(pageNo),
    };
    if (q) filters.PRDT_NM = q;
    let operation = 'InfoAccTpNmCstdyPlace';
    if (recent) {
      operation = 'InfoAccToClAreaPd';
      filters.numOfRows = '60';
    } else if (station) {
      filters.DEP_PLACE = station[1] + '(' + station[2] + ')';
    } else if (site) {
      operation = 'InfoAccToLc';
      filters.ADDR = site.address.match(
        /[가-힣A-Za-z0-9·.]+(?:로|길|대로)\s+(?:지하\s*)?\d+(?:-\d+)?/u,
      )![0];
    } else if (place) filters.DEP_PLACE = place;
    // 통합 명칭 검색은 공항·상점·지하철을 모두 포함하므로 포털 원본 한 목록만 조회합니다.
    const search = itemSearch(q);
    // 장소가 지정되어 있으면 그 보관처의 모든 이름을 대조합니다. 전국 조회는 같은 이름들을 합쳐 읽습니다.
    const lookup =
      [...search.terms].sort((a, b) => a.length - b.length)[0] ?? [];
    const expanded =
      supplementWallet && source === '포털기관'
        ? lookup.filter((word) => word !== '지갑')
        : lookup;
    const variants = expanded.filter(
      (word) =>
        !expanded.some(
          (other) =>
            other !== word && word.toLowerCase().includes(other.toLowerCase()),
        ),
    );
    let list: Awaited<ReturnType<typeof this.list>>;
    let partial = false;
    if (q && (place || site)) {
      delete filters.PRDT_NM;
      list = await this.list(source, operation, filters);
    } else if (lookup[0] === '핸드폰') {
      delete filters.PRDT_NM;
      list = await this.list(source, 'InfoAccToClAreaPd', {
        ...filters,
        PRDT_CL_CD_01: 'PRJ000',
        START_YMD: since(days).replaceAll('-', ''),
        END_YMD: koreaDay().replaceAll('-', ''),
      });
    } else if (q && variants.length) {
      const batches = await readBatches(
        variants.map(
          (word) => () =>
            this.list(source, operation, { ...filters, PRDT_NM: word }),
        ),
        3,
      );
      const pages = batches.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      partial = batches.some((result) => result.status === 'rejected');
      if (!pages.length || (strict && partial))
        throw Error('Incomplete name search');
      list = {
        ...pages[0],
        records: pages.flatMap((p) => p.records),
        limited: pages.some((p) => p.limited),
        total: pages.every((p) => p.total !== null)
          ? pages.reduce((n, p) => n + (p.total ?? 0), 0)
          : null,
      };
    } else {
      list = await this.list(source, operation, filters);
    }
    if (
      strict &&
      (list.total === null ||
        (list.limited && pageNo >= 9999) ||
        (list.total > 0 && !list.records.length && pageNo === 1))
    )
      throw Error('Incomplete agency list');
    const records = [
      ...new Map(list.records.map((r) => [r.atcId + ':' + r.fdSn, r])).values(),
    ];
    const cutoff = since(days);
    const candidates = records.filter((row) => {
      if (!row.atcId || !row.fdSn || !row.depPlace) return false;
      if (
        cutoff &&
        (row.fdYmd || '').replaceAll('-', '') < cutoff.replaceAll('-', '')
      )
        return false;
      if (q && !matchesName(search, row.fdPrdtNm || '', row.prdtClNm || ''))
        return false;
      if (!site) return true;
      if (station) return stationKey(row.depPlace) === stationKey(site.name);
      if (roadKey(row.addr || '') !== road) return false;
      // 주소가 다른 도시에서도 같을 수 있어, 기관 이름도 확인합니다.
      const name = clean(site.name).replace(/\d+호선$/, '');
      const storage = clean(row.depPlace);
      return (
        name.length >= 2 &&
        (storage.includes(name) ||
          (storage.length >= 3 && name.includes(storage)))
      );
    });
    const shortlist = candidates.sort((a, b) =>
      (b.fdYmd || '')
        .replaceAll('-', '')
        .localeCompare((a.fdYmd || '').replaceAll('-', '')),
    );
    const limit = site ? 12 : 24;
    const checked = await readBatches(
      shortlist.slice(offset, offset + limit).map((row) => async () => {
        const detail = await this.list(source, 'DetailInfo', {
          ATC_ID: row.atcId,
          FD_SN: row.fdSn,
        });
        const current = detail.records.find(
          (x) => x.atcId === row.atcId && x.fdSn === row.fdSn,
        );
        if (!current?.csteSteNm?.trim()) throw Error('Missing detail');
        const item = await this.verifiedItem(
          { ...row, ...current },
          source,
          detail.observedAt,
        );
        if (
          q &&
          item &&
          !matchesName(
            search,
            item.name,
            current.prdtClNm || row.prdtClNm || '',
          )
        )
          return;
        if (site && clean(current.depPlace || '') !== clean(row.depPlace))
          return;
        return item && item.date >= cutoff && item.date <= koreaDay()
          ? item
          : undefined;
      }),
      8,
    );
    const items = checked.flatMap((r) =>
      r.status === 'fulfilled' && r.value ? [r.value] : [],
    );
    const loadFailed = partial || checked.some((r) => r.status === 'rejected');
    if (strict && loadFailed) throw Error('Incomplete agency details');
    return {
      items,
      loadFailed,
      next:
        offset + limit < shortlist.length
          ? [pageNo, offset + limit]
          : list.limited && pageNo < 9999
            ? [pageNo + 1, 0]
            : null,
      limited: loadFailed || list.limited || shortlist.length > offset + limit,
    };
  }
  // 이미 승인된 포털 키를 사용하며, 이용자의 조회를 위해 일일 상세 호출 여유를 남깁니다.
  private async updateWalletSnapshot(db: DatabaseService) {
    const query = walletSnapshot;
    const pause = (ms: number) => new Date(Date.now() + ms);
    while (!this.stopping) {
      const step = await db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext('missu-wallet-count')::bigint) AS locked`;
          if (!lock.locked) return false;
          const job = await tx.agencyCountSnapshot.findUniqueOrThrow({
            where: { query },
          });
          if (job.retryAt.getTime() > Date.now()) return false;
          const generation = job.generation;
          const scope = { query, generation };
          const defer = async (ms: number) => {
            await tx.agencyCountSnapshot.update({
              where: { query },
              data: { retryAt: pause(ms) },
            });
            return false;
          };
          if (!job.listed) {
            // 전국 명칭 목록에 모든 보관처가 들어 있어 역·호선별 중복 목록은 추가로 읽지 않습니다.
            const page = job.page;
            const p = await this.list('포털기관', 'InfoAccTpNmCstdyPlace', {
              PRDT_NM: '지갑',
              numOfRows: '500',
              pageNo: String(page),
            }).catch((error: unknown) =>
              error instanceof DailyPortalLimit ? error : null,
            );
            if (p instanceof DailyPortalLimit)
              return defer(nextPortalDay() - Date.now());
            if (
              !p ||
              p.total === null ||
              p.page !== page ||
              p.size <= 0 ||
              p.records.length !==
                Math.max(0, Math.min(p.size, p.total - (page - 1) * p.size))
            )
              return defer(60000);
            // 원본 건수가 바뀌어 페이지 경계가 밀렸을 때 기존 확인 결과는 두고 목록만 다시 읽습니다.
            if (job.listTotal !== null && p.total !== job.listTotal) {
              await tx.agencyCountCandidate.deleteMany({ where: scope });
              await tx.agencyCountSnapshot.update({
                where: { query },
                data: { page: 1, listTotal: null },
              });
              return true;
            }
            const from = since().replaceAll('-', ''),
              to = koreaDay().replaceAll('-', '');
            const candidates = p.records.filter((r) => {
              const day = (r.fdYmd || '').replaceAll('-', '');
              return r.atcId && r.fdSn && day >= from && day <= to;
            });
            if (candidates.length)
              await tx.agencyCountCandidate.createMany({
                data: candidates.map((r) => ({
                  ...scope,
                  atcId: r.atcId,
                  fdSn: r.fdSn,
                })),
                skipDuplicates: true,
              });
            await tx.agencyCountSnapshot.update({
              where: { query },
              data: {
                listTotal: p.total,
                page: page + 1,
                listed: !p.limited,
              },
            });

            return true;
          }
          const candidates = await tx.agencyCountCandidate.findMany({
            where: {
              ...scope,
              stored: null,
              OR: [{ retryAfter: null }, { retryAfter: { lte: new Date() } }],
            },
            select: { atcId: true, fdSn: true },
            orderBy: [{ atcId: 'asc' }, { fdSn: 'asc' }],
            take: 24,
          });
          if (!candidates.length) {
            const pending = await tx.agencyCountCandidate.findFirst({
              where: { ...scope, stored: null },
              orderBy: { retryAfter: 'asc' },
              select: { retryAfter: true },
            });
            if (pending)
              return defer(
                Math.max(
                  60000,
                  (pending.retryAfter?.getTime() ?? Date.now()) - Date.now(),
                ),
              );
            const total = await tx.agencyCountCandidate.count({
              where: { ...scope, stored: true },
            });
            await tx.agencyCountSnapshot.update({
              where: { query },
              data: {
                total,
                completedAt: new Date(),
                generation: generation + 1,
                page: 1,
                listTotal: null,
                listed: false,
                retryAt: pause(86400000),
              },
            });
            // 이전 세대는 진행 중인 경찰 중복 검사에 쓸 수 있게 한 세대 더 보관합니다.
            await tx.agencyCountCandidate.deleteMany({
              where: { query, generation: { lt: generation - 1 } },
            });
            return false;
          }
          const day = new Date(Date.now() + 9 * 3600000)
            .toISOString()
            .slice(0, 10);
          const budget = await tx.agencyCountBudget.upsert({
            where: { day },
            create: { day, calls: 0 },
            update: {},
          });
          if (budget.calls + candidates.length > 8000)
            return defer(nextPortalDay() - Date.now());
          await tx.agencyCountBudget.update({
            where: { day },
            data: { calls: { increment: candidates.length } },
          });
          const checks = await readBatches(
            candidates.map(({ atcId, fdSn }) => async () => {
              const response = await this.list('포털기관', 'DetailInfo', {
                ATC_ID: atcId,
                FD_SN: fdSn,
              });
              const row = response.records.find(
                (r) => r.atcId === atcId && r.fdSn === fdSn,
              );
              if (!row?.csteSteNm) throw Error('Incomplete custody record');
              return {
                atcId,
                fdSn,
                stored: !!(await this.verifiedItem(
                  row,
                  '포털기관',
                  response.observedAt,
                  tx,
                )),
              };
            }),
            8,
          );
          for (const stored of [true, false]) {
            const rows = checks.flatMap((c) =>
              c.status === 'fulfilled' && c.value.stored === stored
                ? [{ atcId: c.value.atcId, fdSn: c.value.fdSn }]
                : [],
            );
            if (rows.length)
              await tx.agencyCountCandidate.updateMany({
                where: { ...scope, OR: rows },
                data: { stored, retryAfter: null },
              });
          }
          // 일일 한도는 개별 물품 재시도로 해결되지 않으므로, 이미 확인된 자료만 보존하고 다음 날 재개합니다.
          if (
            checks.some(
              (c) =>
                c.status === 'rejected' && c.reason instanceof DailyPortalLimit,
            )
          ) {
            return defer(nextPortalDay() - Date.now());
          }
          const failed = candidates.filter(
            (_, index) => checks[index].status === 'rejected',
          );
          if (failed.length) {
            await tx.agencyCountCandidate.updateMany({
              where: { ...scope, OR: failed },
              data: { retryAfter: pause(3600000) },
            });
            if (failed.length === candidates.length) return defer(60000);
          }
          return true;
        },
        { timeout: 60000 },
      );
      if (!step) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  private async part<T extends InstitutionItem>(
    source: Source,
    run: () => Promise<{ items: T[]; limited?: boolean; loadFailed?: boolean }>,
  ): Promise<Result<T>> {
    try {
      const { items, limited, loadFailed } = await run();
      return {
        items,
        notices: loadFailed
          ? [source + ' 자료 일부를 불러오지 못했어요.']
          : limited
            ? [source + ' 자료는 일부만 표시해요.']
            : [],
      };
    } catch {
      return {
        items: [],
        unavailableSource: source,
        notices: [source + ' 자료를 현재 조회할 수 없어요.'],
      };
    }
  }
  async search(
    q: string,
    place: string,
    days: string,
    cursor?: string,
    strict = false,
    supplementWallet = false,
  ) {
    const search = itemSearch(q, place);
    const storagePlace = search.place.replace(
      /^(.+역)\s+([^()]+(?:호선|선))$/u,
      '$1($2)',
    );
    if (!storagePlace) {
      const result = await this.page(
        search.q,
        '',
        days,
        false,
        cursor,
        strict,
        supplementWallet,
      );
      result.items.sort(
        (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
      );
      return result;
    }
    const scope = createHash('sha256')
      .update(JSON.stringify([search, days]))
      .digest('hex')
      .slice(0, 12);
    let primary: string | null | undefined = cursor,
      index: number | null = cursor ? null : 1;
    if (cursor?.startsWith('p.')) {
      const parts = cursor.split('.');
      if (
        parts.length !== 4 ||
        parts[1] !== scope ||
        !/^\d{1,6}$/.test(parts[2]) ||
        !/^[\w-]*$/.test(parts[3])
      )
        fail(400, 'VALIDATION_ERROR', '다음 페이지 값이 올바르지 않습니다.');
      index = Number(parts[2]) || null;
      primary = parts[3] || null;
    }
    let moreIndex: number | null = null;
    const [base, extra] = await Promise.all([
      primary === null
        ? { items: [], notices: [], unavailableSources: [], nextCursor: null }
        : this.page(search.q, storagePlace, days, false, primary, strict),
      this.part('포털기관', async () => {
        if (!index) return { items: [] };
        const res = await this.publicPlace(search, days, index);
        moreIndex = res.more ? index + 1 : null;
        return res;
      }),
    ]);
    const result = combine([
      {
        ...base,
        items: base.items.filter((i) =>
          matchesPlace(storagePlace, i.storage, i.foundPlace),
        ),
      },
      extra,
    ]);
    result.items.sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    );
    return {
      ...result,
      unavailableSources: [
        ...new Set([
          ...base.unavailableSources,
          ...(extra.unavailableSource ? [extra.unavailableSource] : []),
        ]),
      ],
      nextCursor:
        cursor && !cursor.startsWith('p.') && !moreIndex
          ? base.nextCursor
          : base.nextCursor || moreIndex
            ? ['p', scope, moreIndex || 0, base.nextCursor || ''].join('.')
            : null,
    };
  }
  async searchTotal(
    q: string,
    place: string,
    days: string,
  ): Promise<CountProgress> {
    const search = itemSearch(q, place);
    q =
      search.terms.length === 1 && search.terms[0][0] === '지갑'
        ? '지갑'
        : search.q;
    place = search.place;
    const result = await this.countSources(q, place, days);
    if (!this.db || result.status === 'complete') return result;
    // 집계 중에도 현재 검색 조건으로 DB에서 보관이 확인된 전체 건수를 제공합니다.
    const confirmedPortal = await this.db.verifiedPortalItem.count({
      where: this.portalWhere(q, place, days),
    });
    return { ...result, confirmedPortal };
  }
  private async countSources(
    q: string,
    place: string,
    days: string,
  ): Promise<CountProgress> {
    let snapshot:
      { total: number; generation: number; checkedAt: string } | undefined;
    if (this.db && q.trim() === '지갑' && !place && days === 'all') {
      const row = await this.db.agencyCountSnapshot.upsert({
        where: { query: walletSnapshot },
        create: { query: walletSnapshot },
        update: {},
      });
      if (row.retryAt.getTime() <= Date.now()) this.startWalletWorker();
      if (!row.completedAt || row.total === null) {
        const scope = { query: walletSnapshot, generation: row.generation };
        const parts = await this.db.agencyCountCandidate.groupBy({
          by: ['stored'],
          where: scope,
          _count: { _all: true },
        });
        return {
          status: 'counting',
          total: null,
          progress: {
            stage: row.listed ? 'checking' : 'listing',
            checked: parts.reduce(
              (n, p) => n + (p.stored === null ? 0 : p._count._all),
              0,
            ),
            candidates: parts.reduce((n, p) => n + p._count._all, 0),
          },
        };
      }
      snapshot = {
        // 완료한 후보 중 오늘도 기간 내에 있고 마지막 확인 상태가 보관인 물품만 합산합니다.
        total: Number(
          (
            await this.db.$queryRaw<
              { n: number }[]
            >`SELECT count(*)::int AS n FROM agency_count_candidates c
          JOIN verified_portal_items v ON v.id = 'lost112:' || c.atc_id || ':' || c.fd_sn
          WHERE c.query=${walletSnapshot} AND c.generation=${row.generation - 1} AND v.stored AND v.day BETWEEN ${since()} AND ${koreaDay()}`
          )[0].n,
        ),
        generation: row.generation - 1,
        checkedAt: row.completedAt.toISOString(),
      };
    }
    const key = JSON.stringify([
      q,
      place,
      days,
      since(days),
      snapshot?.generation,
      snapshot?.total,
    ]);
    const now = Date.now();
    for (const [k, scan] of this.counts) {
      if (!scan.running && scan.expires <= now) this.counts.delete(k);
    }
    let scan = this.counts.get(key);
    if (!scan) {
      if (this.counts.size >= 48) return { status: 'unavailable', total: null };
      scan = {
        ids: new Set(),
        policeIds: new Set(),
        policeAvailable: true,
        cursor: undefined,
        result: { status: 'counting', total: null },
        expires: now + 120000,
      };
      this.counts.set(key, scan);
    }
    if (scan.running) return scan.running;
    if (scan.result.status !== 'counting') {
      if (scan.retryPoliceAt === undefined || now < scan.retryPoliceAt)
        return scan.result;
      // 승인 여부만 다시 확인합니다. 이미 집계한 학교·포털기관 목록은 다시 읽지 않습니다.
      scan.cursor = Buffer.from(
        JSON.stringify(
          sourceList.map((source) => (source === '경찰' ? [1, 0] : null)),
        ),
      ).toString('base64url');
      scan.retryPoliceAt = undefined;
      scan.policeAvailable = true;
      scan.result = {
        status: 'counting',
        total: scan.ids.size + (snapshot?.total ?? 0),
        policeIncluded: false,
      };
    }
    const current = scan;
    // 한 번에 원본 한 페이지를 확인합니다. 같은 검색은 진행 위치와 요청을 공유합니다.
    current.running = this.search(
      q,
      place,
      days,
      current.cursor,
      true,
      !!snapshot,
    )
      .then(async (page) => {
        const located = !!itemSearch(q, place).place;
        if (
          page.unavailableSources.some((source) => source !== '경찰') ||
          (located && page.notices.length)
        ) {
          if (!located) throw Error('Missing source');
          current.incomplete = true;
        }
        if (page.unavailableSources.includes('경찰')) {
          current.policeAvailable = false;
          current.policeIds.clear();
        }
        const agencies = page.items.filter((i) => i.source !== '한성대');
        // 두 기관의 관리번호가 겹치면 포털기관 집계에서 이미 센 물품입니다.
        const overlaps =
          snapshot && agencies.length && this.db
            ? await this.db.$queryRaw<
                { id: string }[]
              >`SELECT v.id FROM verified_portal_items v
                JOIN agency_count_candidates c ON v.id = 'lost112:' || c.atc_id || ':' || c.fd_sn
                WHERE c.query=${walletSnapshot} AND c.generation=${snapshot.generation}
                AND v.stored AND v.day BETWEEN ${since()} AND ${koreaDay()} AND v.id = ANY(${agencies.map((i) => i.id)}::text[])`
            : [];
        const portalIds = new Set(overlaps.map((i) => i.id));
        for (const item of page.items) {
          if (portalIds.has(item.id)) continue;
          if (item.source !== '경찰' || (located && item.lastVerifiedOn))
            current.ids.add(item.id);
          else if (current.policeAvailable && !portalIds.has(item.id))
            current.policeIds.add(item.id);
        }
        if (page.nextCursor) {
          if (page.nextCursor === current.cursor)
            throw Error('Repeated cursor');
          current.cursor = page.nextCursor;
          let confirmedTotal = current.ids.size + (snapshot?.total ?? 0);
          for (const id of current.policeIds)
            if (!current.ids.has(id)) confirmedTotal++;
          current.result = { ...current.result, confirmedTotal };
        } else {
          // 경찰과 포털기관에 동시에 있는 관리번호는 한 번만 셉니다.
          if (current.policeAvailable) {
            for (const id of current.policeIds) current.ids.add(id);
          }
          current.result = {
            status: 'complete',
            total: current.ids.size + (snapshot?.total ?? 0),
            policeIncluded: current.policeAvailable,
            ...(snapshot && { checkedAt: snapshot.checkedAt }),
          };
          if (located && current.incomplete)
            current.result = {
              status: 'unavailable',
              total: null,
              confirmedTotal: current.ids.size,
            };
          current.policeIds.clear();
          if (current.policeAvailable || located) current.ids.clear();
          else {
            current.retryPoliceAt = Date.now() + 120000;
            current.baseExpires ??= Date.now() + 300000;
          }
        }
        return current.result;
      })
      .catch(() => {
        current.ids.clear();
        current.policeIds.clear();
        current.result = { status: 'unavailable', total: null };
        return current.result;
      })
      .finally(() => {
        current.running = undefined;
        const ttl = current.result.status === 'unavailable' ? 15000 : 300000;
        current.expires =
          current.result.status === 'counting'
            ? Date.now() + ttl
            : Math.min(Date.now() + ttl, current.baseExpires ?? Infinity);
      });
    return current.running;
  }
  async recent(cursor?: string) {
    const result = await this.page('', '', 'all', true, cursor);
    result.items.sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    );
    return result;
  }
  private background = new Map<string, number>();
  private portalOffline() {
    return ['DetailInfo', 'InfoAccTpNmCstdyPlace'].some(
      (op) =>
        (this.exhaustedOperations.get('포털기관/' + op) ?? 0) > Date.now(),
    );
  }
  private refreshPortal(
    keyParts: unknown[],
    saved: InstitutionItem[],
    run: () => Promise<PageBatch>,
  ) {
    const key = JSON.stringify(keyParts);
    if (this.portalOffline() || (this.background.get(key) ?? 0) > Date.now())
      return;
    for (const [k, until] of this.background)
      if (until <= Date.now()) this.background.delete(k);
    if (this.background.size >= 32) return;
    this.background.set(key, Date.now() + 120000);
    void (async () => {
      const page = await run();
      if (this.portalOffline() || page.loadFailed) return;
      // 원본 첫 페이지에서 빠진 기존 보관품도 관리번호로 재확인합니다. 매 조회당 최대 3건입니다.
      const fresh = new Set(page.items.map((item) => item.id));
      const stale = saved
        .filter(
          (item) =>
            item.lastVerifiedOn &&
            item.lastVerifiedOn < koreaDay() &&
            !fresh.has(item.id),
        )
        .sort((a, b) => a.lastVerifiedOn!.localeCompare(b.lastVerifiedOn!))
        .slice(0, 3);
      await readBatches(
        stale.map((item) => async () => {
          const [, atcId, fdSn] = item.id.split(':');
          const res = await this.list('포털기관', 'DetailInfo', {
            ATC_ID: atcId,
            FD_SN: fdSn,
          });
          const row = res.records.find(
            (r) => r.atcId === atcId && r.fdSn === fdSn,
          );
          if (row?.csteSteNm?.trim())
            await this.verifiedItem(row, '포털기관', res.observedAt);
        }),
        2,
      );
    })().catch(() => undefined);
  }
  private portalWhere(
    q: string,
    place: string,
    days: string,
    exact = false,
    category = 'ALL',
  ): Prisma.VerifiedPortalItemWhereInput {
    const search = itemSearch(q);
    const { terms, excludedEndings } = search;
    return {
      stored: true,
      day: { gte: since(days), lte: koreaDay() },
      ...(excludedEndings.length && {
        NOT: excludedEndings.map((word) => ({
          name: { endsWith: word, mode: 'insensitive' },
        })),
      }),
      AND: [
        ...brandNameFilter(search),
        ...terms.map((group) => ({
          OR: group.map((word) => ({
            name: { contains: likeLiteral(word), mode: 'insensitive' },
          })),
        })),
      ],
      placeKey: exact
        ? stationKey(place)
        : { contains: likeLiteral(stationKey(place)) },
      ...(category !== 'ALL' && { category }),
    };
  }
  private async savedPage(
    q: string,
    place: string,
    days: string,
    offset: number,
    next: Position[],
    index: number,
    exact = false,
    category = 'ALL',
  ) {
    const rows = await this.db!.verifiedPortalItem.findMany({
      where: this.portalWhere(q, place, days, exact, category),
      orderBy: [{ day: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: 26,
    });
    next[index] = rows.length > 25 ? [0, offset + 25] : null;
    const items: InstitutionItem[] = rows
      .slice(0, 25)
      .map((r) => this.savedItem(r));
    return { items };
  }
  private async page(
    q: string,
    place: string,
    days: string,
    recent: boolean,
    cursor?: string,
    strict = false,
    supplementWallet = false,
  ) {
    let positions: Position[] = sourceList.map(() => [1, 0]);
    if (cursor) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        if (
          !Array.isArray(parsed) ||
          parsed.length !== sourceList.length ||
          !parsed.every(
            (p, i) =>
              p === null ||
              (Array.isArray(p) &&
                p.length === 2 &&
                Number.isInteger(p[0]) &&
                (p[0] >= 1 ||
                  (p[0] === 0 && i === 2 && !strict && !!this.db)) &&
                p[0] <= 9999 &&
                Number.isInteger(p[1]) &&
                p[1] >= 0 &&
                p[1] <= (p[0] === 0 ? 10000000 : 1000)),
          )
        )
          throw Error();
        positions = parsed;
      } catch {
        fail(400, 'VALIDATION_ERROR', '다음 페이지 값이 올바르지 않습니다.');
      }
    }
    const next: Position[] = sourceList.map(() => null);
    const parts = await Promise.all(
      sourceList.map((source, i) =>
        this.part(source, async () => {
          const pos = positions[i];
          if (!pos) return { items: [] };
          if (source === '포털기관' && pos[0] === 0) {
            const saved = await this.savedPage(q, place, days, pos[1], next, i);
            if (!next[i] && !this.portalOffline())
              next[i] = [1, liveFirstOffset];
            return saved;
          }
          if (source === '한성대') {
            const batch = await this.school(q, days, pos[0]);
            if (
              strict &&
              (batch.loadFailed || (batch.limited && pos[0] >= 9999))
            )
              throw Error('Incomplete school board');
            next[i] = batch.limited && pos[0] < 9999 ? [pos[0] + 1, 0] : null;
            return { items: batch.items, loadFailed: batch.loadFailed };
          }
          const canFallback = !!this.db && source === '포털기관' && !strict;
          const fetchLive = () =>
            this.records(
              source,
              q,
              place,
              days,
              undefined,
              recent,
              pos[1] === liveFirstOffset ? [1, 0] : pos,
              strict,
              supplementWallet,
            );
          if (canFallback && pos[0] === 1 && pos[1] === 0) {
            const saved = await this.savedPage(q, place, days, 0, next, i);
            if (saved.items.length) {
              // 화면은 DB에서 응답하고, 사용자가 실제 검색한 조건만 백그라운드에서 재확인합니다.
              this.refreshPortal(
                [q, place, days, recent],
                saved.items,
                fetchLive,
              );
              // 저장 목록을 본 후 '더보기'에서 포털 원본의 다음 결과도 확인할 수 있습니다.
              next[i] ??= this.portalOffline() ? null : [1, liveFirstOffset];
              return saved;
            }
          }
          const batch = await fetchLive().catch((error: unknown) => {
            if (!canFallback) throw error;
            return { items: [], loadFailed: true, limited: true, next: null };
          });
          if (canFallback && batch.loadFailed && pos[1] !== liveFirstOffset) {
            const saved = await this.savedPage(q, place, days, 0, next, i);
            return {
              items: [...saved.items, ...batch.items],
              loadFailed: true,
            };
          }
          next[i] =
            source === '포털기관' && !strict && this.portalOffline()
              ? null
              : (batch.next ?? null);
          // 남은 물품은 다음 페이지로 넘기고, 조회 실패만 검색 안내로 보냅니다.
          return { items: batch.items, loadFailed: batch.loadFailed };
        }),
      ),
    );
    const result = combine(parts);
    let nextCursor = next.some(Boolean)
      ? Buffer.from(JSON.stringify(next)).toString('base64url')
      : null;
    if (
      cursor &&
      !strict &&
      positions.some(Boolean) &&
      parts.every((p, i) => !positions[i] || p.unavailableSource)
    ) {
      if (recent)
        fail(
          503,
          'EXTERNAL_UNAVAILABLE',
          '기관 자료를 불러오지 못했어요. 다시 시도해 주세요.',
        );
      // 후속 페이지 조회 실패도 기관명을 표시하고, 더보기로 같은 페이지를 재시도합니다.
      nextCursor = cursor;
    }
    return {
      ...result,
      unavailableSources: parts.flatMap((p) =>
        p.unavailableSource ? [p.unavailableSource] : [],
      ),
      nextCursor,
    };
  }
  private async uniqueStation(site: Custodian) {
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.search = new URLSearchParams({
      query: site.name,
      category_group_code: 'SW8',
      size: '15',
    }).toString();
    let matched = false;
    for (let page = 1; page <= 3; page++) {
      url.searchParams.set('page', String(page));
      const json = JSON.parse(
        (
          await this.text(url.href, url, {
            Authorization: 'KakaoAK ' + process.env.KAKAO_REST_API_KEY,
          })
        ).body,
      ) as { documents: KakaoPlace[]; meta?: { is_end: boolean } };
      for (const p of json.documents) {
        if (stationKey(p.place_name) !== stationKey(site.name)) continue;
        if (distance(site, { lat: Number(p.y), lng: Number(p.x) }) >= 100)
          return false;
        matched = true;
      }
      if (json.meta?.is_end) return matched;
    }
    return false;
  }
  private async places(
    source: Source,
    query: NearbyDto,
    all = false,
  ): Promise<{ sites: Custodian[]; limited: boolean }> {
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key) throw Error('No geocoder');
    const terms =
      source === '한성대'
        ? ['한성대학교 상상관']
        : source === '경찰'
          ? ['경찰서', '지구대', '파출소']
          : ['지하철역', '지하철 유실물센터'];
    const groups = await Promise.allSettled(
      terms.map(async (term) => {
        // 지도 제공자에는 반올림한 중심만 전달하고 최종 거리는 실제 중심에서 계산합니다.
        const stations = source === '포털기관' && term === '지하철역';
        const url = new URL(
          'https://dapi.kakao.com/v2/local/search/' +
            (stations ? 'category' : 'keyword') +
            '.json',
        );
        url.search = new URLSearchParams({
          ...(stations ? { category_group_code: 'SW8' } : { query: term }),
          x: query.lng.toFixed(3),
          y: query.lat.toFixed(3),
          radius: String(query.radiusM + 150),
          sort: 'distance',
          size: '15',
        }).toString();
        const documents: KakaoPlace[] = [];
        let limited = false;
        for (let page = 1; ; page++) {
          if (page > 1) url.searchParams.set('page', String(page));
          const json = JSON.parse(
            (
              await this.text(url.href, url, {
                Authorization: 'KakaoAK ' + key,
              })
            ).body,
          ) as { documents: KakaoPlace[]; meta?: { is_end: boolean } };
          if (!Array.isArray(json.documents))
            throw Error('Unknown place response');
          documents.push(...json.documents);
          limited = json.meta?.is_end === false;
          if (!all || !limited || page === 3) break;
        }
        const sites: Custodian[] = [];
        for (const doc of documents) {
          if (!doc.x || !doc.y || !doc.place_name) continue;
          if (
            source === '한성대' &&
            clean(doc.place_name) !== '한성대학교상상관'
          )
            continue;
          if (
            source === '경찰' &&
            !/(경찰서|지구대|파출소)$/u.test(doc.place_name)
          )
            continue;
          if (
            source === '포털기관' &&
            doc.category_group_code !== 'SW8' &&
            !/유실물센터/u.test(doc.place_name)
          )
            continue;
          const site = {
            source,
            name: doc.place_name,
            address: doc.road_address_name || '',
            lat: Number(doc.y),
            lng: Number(doc.x),
          };
          if (distance(query, site) <= query.radiusM) sites.push(site);
        }
        return { sites, limited };
      }),
    );
    if (groups.every((g) => g.status === 'rejected'))
      throw Error('Location lookup failed');
    const unique = new Map(
      groups
        .flatMap((g) => (g.status === 'fulfilled' ? g.value.sites : []))
        .map((s) => [s.name + '|' + s.address, s]),
    );
    const sites = [...unique.values()].sort(
      (a, b) => distance(query, a) - distance(query, b),
    );
    return {
      sites: all ? sites : sites.slice(0, 4),
      limited:
        (!all && sites.length > 4) ||
        groups.some((g) => g.status === 'rejected' || g.value.limited),
    };
  }
  private readonly schoolCounts = new Map<
    string,
    { value: Promise<Map<string, InstitutionItem>>; expires: number }
  >();
  async schoolForMatching() {
    return [...(await this.schoolInventory('', 'ALL')).values()];
  }
  private schoolInventory(q: string, days: string) {
    const key = JSON.stringify([q, days, koreaDay()]);
    const cached = this.schoolCounts.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    for (const [k, v] of this.schoolCounts)
      if (v.expires <= Date.now()) this.schoolCounts.delete(k);
    if (this.schoolCounts.size >= 24) throw Error('School count busy');
    // 같은 학교·검색어의 전체 목록은 반경과 분류가 바뀌어도 함께 사용합니다.
    const value = (async () => {
      const items = new Map<string, InstitutionItem>();
      for (let page = 1; page <= 9999; page++) {
        const result = await this.school(q, days, page);
        if (result.loadFailed) throw Error('School details unavailable');
        for (const item of result.items) items.set(item.id, item);
        if (!result.limited) return items;
      }
      throw Error('School list incomplete');
    })();
    const entry = { value, expires: Infinity };
    this.schoolCounts.set(key, entry);
    void value.then(
      () => {
        entry.expires = Date.now() + 300000;
      },
      () => {
        this.schoolCounts.delete(key);
      },
    );
    return value;
  }
  private async venueItems(
    source: Provider,
    query: NearbyDto,
    site: Custodian,
  ) {
    const station = source === '포털기관' && /역\s+.+$/u.test(site.name);
    if (station && !(await this.uniqueStation(site)))
      return { items: [], failed: true };
    const items = new Map<string, InstitutionItem>();
    let failed = false;
    // 목록 한 묶음(12건) 뒤에 남은 상세와 원본의 다음 페이지를 모두 읽습니다.
    let pos: Position = [1, 0];
    try {
      while (pos) {
        const batch: PageBatch = await this.records(
          source,
          query.q || '',
          '',
          query.registeredDays,
          site,
          false,
          pos,
        );
        for (const item of batch.items) items.set(item.id, item);
        failed ||= !!batch.loadFailed || (!!batch.limited && !batch.next);
        pos = batch.next || null;
      }
    } catch {
      failed = true;
    }
    if (station) {
      const publicList = await this.publicStation(site, query.registeredDays);
      failed ||= publicList.failed;
      if (this.db) {
        const stored = await this.db.verifiedPortalItem.findMany({
          where: {
            stored: true,
            placeKey: stationKey(site.name),
            day: { gte: since(query.registeredDays), lte: koreaDay() },
          },
        });
        const saved = stored.map((r) => this.savedItem(r));
        // 이전에 확인한 물품은 기관 한도 소진 중에도 남겨 두고 오래된 보관 상태를 다시 확인합니다.
        this.refreshPortal(['station-recheck', site.name], saved, async () => ({
          items: [
            ...items.values(),
            ...Array.from(publicList.records.values()).filter(
              (i): i is InstitutionItem => !!i,
            ),
          ],
          limited: false,
        }));
        for (const item of saved)
          if (!items.has(item.id)) items.set(item.id, item);
      }
      for (const [id, item] of publicList.records) {
        if (item) items.set(id, item);
        else items.delete(id);
      }
    }
    const cutoff = since(query.registeredDays),
      end = koreaDay(),
      term = clean(query.q || '');
    const located = [...items.values()]
      .filter(
        (i) =>
          i.date >= cutoff &&
          i.date <= end &&
          clean(i.name).includes(term) &&
          (query.category === 'ALL' || query.category === i.category),
      )
      .map((i) => ({
        ...i,
        distanceM: Math.round(distance(query, site)),
        foundLocation: {
          lat: site.lat,
          lng: site.lng,
          label: '보관처 · ' + i.storage,
        },
      }));
    return { items: located, failed };
  }
  private async nearbyProvider(source: Provider, query: NearbyDto) {
    return this.part<Located>(source, async () => {
      const { sites, limited } = await this.places(source, query, true);
      const checks = await readBatches(
        sites.map((site) => () => this.venueItems(source, query, site)),
        3,
      );
      return {
        items: checks.flatMap((r) =>
          r.status === 'fulfilled' ? r.value.items : [],
        ),
        loadFailed:
          limited ||
          checks.some((r) => r.status === 'rejected' || r.value.failed),
      };
    });
  }
  // 목록과 건수가 동일한 반경·필터의 같은 조회 결과를 사용합니다.
  private readonly areas = new Map<
    string,
    {
      parts: Promise<Result<Located>[]>;
      expires: number;
      count?: NearbyCountJob;
    }
  >();
  private area(query: NearbyDto) {
    const key = JSON.stringify([
      query.lat,
      query.lng,
      query.radiusM,
      query.category,
      query.registeredDays,
      query.q || '',
      koreaDay(),
    ]);
    for (const [k, v] of this.areas)
      if (v.expires <= Date.now()) this.areas.delete(k);
    const cached = this.areas.get(key);
    if (cached) return cached;
    if (this.areas.size >= 32) throw Error('Nearby lookup busy');
    const parts = Promise.all([
      this.nearbyProvider('경찰', query),
      this.nearbyProvider('포털기관', query),
    ]);
    const entry: {
      parts: typeof parts;
      expires: number;
      count?: NearbyCountJob;
    } = { parts, expires: Infinity };
    this.areas.set(key, entry);
    void parts.then(
      (p) => {
        entry.expires =
          Date.now() + (p.some((r) => r.notices.length) ? 60000 : 300000);
      },
      () => this.areas.delete(key),
    );
    return entry;
  }
  nearbyTotal(query: NearbyDto): NearbyCount {
    let area: ReturnType<typeof this.area>;
    try {
      area = this.area(query);
    } catch {
      return { status: 'unavailable', total: null, incomplete: [] };
    }
    if (area.count) return area.count.result;
    const job: NearbyCountJob = {
      result: { status: 'counting', total: null, incomplete: [] },
    };
    area.count = job;
    const schoolCount = async () => {
      const { sites, limited } = await this.places('한성대', query, true);
      if (!sites.length) {
        if (limited) throw Error('School lookup unavailable');
        return 0;
      }
      const inventory = await this.schoolInventory(
        query.q || '',
        query.registeredDays,
      );
      return [...inventory.values()].filter(
        (item) => query.category === 'ALL' || item.category === query.category,
      ).length;
    };
    void Promise.all([area.parts, schoolCount().catch(() => null)]).then(
      ([parts, school]) => {
        const incomplete: Source[] = [];
        if (school === null) incomplete.push('한성대');
        if (parts[0].notices.length) incomplete.push('경찰');
        if (parts[1].notices.length) incomplete.push('포털기관');
        job.result = {
          total: (school || 0) + combine(parts).items.length,
          status: incomplete.length ? 'partial' : 'complete',
          incomplete,
        };
        if (incomplete.length)
          area.expires = Math.min(area.expires, Date.now() + 60000);
      },
    );
    return job.result;
  }
  private async nearbySchool(query: NearbyDto, startPage: number) {
    // 다음 페이지에서 실패해도 같은 위치에서 재시도할 수 있게 합니다.
    let page = startPage;
    let nextCursor: string | null = 'school:' + page;
    const part = await this.part<Located>('한성대', async () => {
      const { sites } = await this.places('한성대', query);
      const site = sites[0];
      if (!site) {
        nextCursor = null;
        return { items: [] };
      }
      const distanceM = Math.round(distance(query, site));
      // 전부 반환됐거나 분류가 다른 페이지는 건너뜁니다. 한 요청에 읽는 페이지 수를 제한합니다.
      for (let step = 0; ; step++) {
        nextCursor = 'school:' + page;
        const batch = await this.school(
          query.q || '',
          query.registeredDays,
          page,
        );
        const items = batch.items
          .filter(
            (item) =>
              query.category === 'ALL' || item.category === query.category,
          )
          .map((item) => ({
            ...item,
            distanceM,
            foundLocation: {
              lat: site.lat,
              lng: site.lng,
              label: '보관처 · ' + item.storage,
            },
          }));
        if (batch.loadFailed) return { items, loadFailed: true };
        page++;
        nextCursor = batch.limited ? 'school:' + page : null;
        if (items.length || !nextCursor || step === 2) return { items };
      }
    });
    return { part, nextCursor };
  }
  async nearby(query: NearbyDto) {
    const cursor = query.cursor;
    const schoolPage = cursor?.match(/^school:([1-9]\d{0,5})$/);
    if (schoolPage) {
      const { part, nextCursor } = await this.nearbySchool(
        query,
        Number(schoolPage[1]),
      );
      return { ...part, nextCursor };
    }
    const more = cursor?.match(/^area:([1-9]\d{0,6}):(\d{1,6})$/);
    if (cursor && !more)
      fail(400, 'VALIDATION_ERROR', '다음 페이지 정보가 올바르지 않습니다.');
    const offset = more ? Number(more[1]) : 0;
    const [parts, school] = await Promise.all([
      this.area(query).parts,
      more ? null : this.nearbySchool(query, 1),
    ]);
    const agencies = combine(parts);
    const order = (a: Located, b: Located) =>
      a.distanceM - b.distanceM ||
      b.date.localeCompare(a.date) ||
      a.id.localeCompare(b.id);
    agencies.items.sort(order);
    const schoolNext = more
      ? Number(more[2])
      : Number(school?.nextCursor?.slice(7) || 0);
    const page = agencies.items.slice(offset, offset + 25);
    const nextCursor =
      offset + 25 < agencies.items.length
        ? 'area:' + (offset + 25) + ':' + schoolNext
        : schoolNext
          ? 'school:' + schoolNext
          : null;
    const result = combine([
      ...(school ? [school.part] : []),
      { items: page, notices: agencies.notices },
    ]);
    result.items.sort(order);
    return { ...result, nextCursor };
  }
}
