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
  distance,
  governmentItem,
  koreaDay,
  sinceFound as since,
  schoolDetail,
  schoolList,
  schoolArticle,
  policeSite,
  policePage,
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
  private async text(key: string, url: URL, headers?: Record<string, string>) {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now())
      return { body: await cached.value, observedAt: cached.observedAt };
    if (this.cache.size >= 400)
      this.cache.delete(this.cache.keys().next().value!);
    const observedAt = new Date();
    const value = this.http
      .request(url.toString(), {
        headers,
        ...(url.hostname === 'apis.data.go.kr' && {
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
    if (q) {
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
        .filter((i) => i.date >= cutoff)
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
    let result;
    try {
      result = await this.list(source, 'DetailInfo', {
        ATC_ID: m[1],
        FD_SN: m[2],
      });
    } catch {
      if (!saved)
        return fail(
          503,
          'EXTERNAL_UNAVAILABLE',
          '기관 상세를 불러올 수 없어요. 잠시 후 다시 확인해 주세요.',
        );
      return this.savedItem(saved);
    }
    const row = result.records.find((r) => r.atcId === m[1] && r.fdSn === m[2]);
    if (!row?.csteSteNm) return saved ? this.savedItem(saved) : missing();
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
      phone: r.phone ?? undefined,
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
    const list = await this.list(source, operation, filters);
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
    const loadFailed = checked.some((r) => r.status === 'rejected');
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
  ) {
    const storagePlace = place.replace(
      /^(.+역)\s+([^()]+(?:호선|선))$/u,
      '$1($2)',
    );
    const result = await this.page(
      q,
      storagePlace,
      days,
      false,
      cursor,
      strict,
    );
    result.items = result.items
      .filter(
        (x) =>
          x.date >= since(days) &&
          (!storagePlace ||
            stationKey(x.storage).includes(stationKey(storagePlace))),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }
  async searchTotal(
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
        cursor: snapshot
          ? Buffer.from(JSON.stringify([[1, 0], [1, 0], null])).toString(
              'base64url',
            )
          : undefined,
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
    current.running = this.search(q, place, days, current.cursor, true)
      .then(async (page) => {
        if (page.unavailableSources.some((source) => source !== '경찰'))
          throw Error('Missing source');
        if (page.unavailableSources.includes('경찰')) {
          current.policeAvailable = false;
          current.policeIds.clear();
        }
        const police = page.items.filter((i) => i.source === '경찰');
        // 두 기관의 관리번호가 겹치면 포털기관 집계에서 이미 센 물품입니다.
        const overlaps =
          snapshot && police.length && this.db
            ? await this.db.$queryRaw<
                { id: string }[]
              >`SELECT v.id FROM verified_portal_items v
                JOIN agency_count_candidates c ON v.id = 'lost112:' || c.atc_id || ':' || c.fd_sn
                WHERE c.query=${walletSnapshot} AND c.generation=${snapshot.generation}
                AND v.stored AND v.day BETWEEN ${since()} AND ${koreaDay()} AND v.id = ANY(${police.map((i) => i.id)}::text[])`
            : [];
        const portalIds = new Set(overlaps.map((i) => i.id));
        for (const item of page.items) {
          if (item.source !== '경찰') current.ids.add(item.id);
          else if (current.policeAvailable && !portalIds.has(item.id))
            current.policeIds.add(item.id);
        }
        if (page.nextCursor) {
          if (page.nextCursor === current.cursor)
            throw Error('Repeated cursor');
          current.cursor = page.nextCursor;
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
          current.policeIds.clear();
          if (current.policeAvailable) current.ids.clear();
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
    const escape = (s: string) => s.replace(/[\\%_]/g, '\\$&');
    const rows = await this.db!.verifiedPortalItem.findMany({
      where: {
        stored: true,
        day: { gte: since(days), lte: koreaDay() },
        name: { contains: escape(q), mode: 'insensitive' },
        placeKey: exact
          ? stationKey(place)
          : { contains: escape(stationKey(place)) },
        ...(category !== 'ALL' && { category }),
      },
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
        const json = JSON.parse(
          (await this.text(url.href, url, { Authorization: 'KakaoAK ' + key }))
            .body,
        ) as { documents: KakaoPlace[]; meta?: { is_end: boolean } };
        if (!Array.isArray(json.documents))
          throw Error('Unknown place response');
        const sites: Custodian[] = [];
        for (const doc of json.documents) {
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
        return { sites, limited: json.meta?.is_end === false };
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
      sites: sites.slice(0, 4),
      limited:
        sites.length > 4 ||
        groups.some((g) => g.status === 'rejected' || g.value.limited),
    };
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
    if (query.cursor && !/^school:[1-9]\d{0,5}$/.test(query.cursor))
      fail(400, 'VALIDATION_ERROR', '다음 페이지 정보가 올바르지 않습니다.');
    const page = query.cursor ? Number(query.cursor.slice(7)) : 1;
    const school = this.nearbySchool(query, page);
    if (query.cursor) {
      const { part, nextCursor } = await school;
      return { ...part, nextCursor };
    }
    const parts = await Promise.all(
      sourceList
        .filter((source) => source !== '한성대')
        .map((source) =>
          this.part<Located>(source, async () => {
            if (source === '경찰' && !process.env.DATA_GO_KR_SERVICE_KEY)
              throw Error('Agency access pending');
            const { sites, limited } = await this.places(source, query);
            const pages = await Promise.allSettled(
              sites.map(async (site) => {
                const live = async () =>
                  this.records(
                    source,
                    query.q || '',
                    '',
                    query.registeredDays,
                    site,
                  );
                let batch: Awaited<ReturnType<typeof live>>;
                const station =
                  source === '포털기관' && /역\s+.+선$/u.test(site.name);
                if (station && this.db && (await this.uniqueStation(site))) {
                  const saved = await this.savedPage(
                    query.q || '',
                    site.name,
                    query.registeredDays,
                    0,
                    [],
                    0,
                    true,
                    query.category,
                  );
                  if (saved.items.length) {
                    this.refreshPortal(
                      ['nearby', site.name, query.q, query.registeredDays],
                      saved.items,
                      () =>
                        this.records(
                          '포털기관',
                          query.q || '',
                          '',
                          query.registeredDays,
                          site,
                        ),
                    );
                    batch = { items: saved.items, limited: false };
                  } else batch = await live();
                } else batch = await live();
                const items = batch.items
                  .filter(
                    (i) =>
                      i.date >= since(query.registeredDays) &&
                      (query.category === 'ALL' ||
                        i.category === query.category),
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
                return { items, limited: batch.limited };
              }),
            );
            if (pages.length && pages.every((p) => p.status === 'rejected'))
              throw Error('Source unavailable');
            return {
              items: pages.flatMap((p) =>
                p.status === 'fulfilled' ? p.value.items : [],
              ),
              limited:
                limited ||
                pages.some((p) => p.status === 'rejected' || p.value.limited),
            };
          }),
        ),
    );
    const { part, nextCursor } = await school;
    const result = combine([part, ...parts]);
    result.items.sort(
      (a, b) => a.distanceM - b.distanceM || b.date.localeCompare(a.date),
    );
    return { ...result, nextCursor };
  }
}
