import {
  CatalogSync,
  catalogCoverage,
  DailyPortalLimit,
  nextPortalDay,
} from './catalog-sync';
import { createHash } from 'node:crypto';
import { countVerifiedDays } from './verified-search-count';
import {
  itemSearch,
  publicFoundWhere,
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
import { Prisma } from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { fail } from '../common/http';
import { ExternalHttpService } from '../integrations/external-http.service';
import { NearbyDto } from './nearby.dto';
import { NearbyService } from './nearby.service';
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
  policePhoto,
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
type NearbyCount = {
  status: 'counting' | 'complete' | 'partial' | 'unavailable';
  total: number | null;
  confirmedTotal?: number;
  // 동일 조건의 회원·기관 합계입니다. 기관 소계에 더하지 않습니다.
  lastAreaTotal?: number;
  incomplete: Source[];
};
type NearbyCountJob = { result: NearbyCount; previous: Promise<number | null> };
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
  lastComplete?: { total: number; checkedAt: Date; policeIncluded: boolean };
  confirmedPortal?: number;
  confirmedTotal?: number;
  policeIncluded?: boolean;
  checkedAt?: string;
  refreshAfterMs?: number;
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
    @Optional() private readonly members?: NearbyService,
  ) {}
  private catalog?: CatalogSync;
  private timer?: ReturnType<typeof setInterval>;
  private readonly activeCounts = new Map<string, Promise<number>>();
  private readonly logger = new Logger(InstitutionItemsService.name);
  onApplicationBootstrap() {
    if (!this.db) return;
    if (process.env.DATA_GO_KR_SERVICE_KEY)
      this.catalog = new CatalogSync(
        this.db,
        (source, op, params) => this.list(source, op, params),
        (row, source, at, tx) => this.verifiedItem(row, source, at, tx),
      );
    const warmSchool = process.env.NODE_ENV !== 'test';
    if (!this.catalog && !warmSchool) return;
    const wake = () => {
      void this.warmStoragePoints();
      if (warmSchool)
        void this.refreshSchool().catch(() =>
          this.logger.warn('한성대 보관 목록을 다음 주기에 다시 확인합니다.'),
        );
      void this.catalog
        ?.run()
        ?.catch(() =>
          this.logger.warn(
            '기관 보관 상태 수집을 다음 주기에 다시 시도합니다.',
          ),
        );
    };
    this.timer = setInterval(wake, 60000);
    this.timer.unref();
    wake();
    if (warmSchool) void this.warmCommonCounts();
  }
  private async warmCommonCounts() {
    // 시작 응답을 막지 않고 자주 찾는 세 검색어를 한 번에 하나씩 준비한다.
    for (const word of ['이어폰', '지갑', '핸드폰']) {
      try {
        await this.verifiedCount(word, '', 'all', Date.now());
      } catch {
        this.logger.warn('기관 검색 건수는 다음 조회에서 다시 확인합니다.');
      }
    }
  }
  private verifiedCount(q: string, place: string, days: string, now: number) {
    const from = since(days, now);
    const through = koreaDay(now);
    const request = JSON.stringify([q, place, days, from, through]);
    const active = this.activeCounts.get(request);
    if (active) return active;
    const pending = countVerifiedDays(
      this.db!,
      days,
      from,
      through,
      this.portalWhere(q, place, days),
    ).finally(() => this.activeCounts.delete(request));
    this.activeCounts.set(request, pending);
    return pending;
  }
  async syncStatus() {
    if (!this.catalog) return { enabled: false, providers: [] };
    return { enabled: true, providers: await this.catalog.status() };
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.stoppedPoints = true;
    this.catalog?.stop();
  }

  /** 직접 지정한 끝일까지 같은 검색 색인을 사용해 기관 건수를 따로 읽습니다. */
  countForMatching(q: string, place: string, from: string, through: string) {
    return countVerifiedDays(
      this.db!,
      'all',
      from,
      through,
      this.portalWhere(q, place, 'all'),
    );
  }

  private warmingPoints = false;
  private stoppedPoints = false;
  private pointsInitialized = false;
  private nextPlaceDiscovery = 0;
  private async warmStoragePoints() {
    if (
      !this.db ||
      this.warmingPoints ||
      !process.env.KAKAO_REST_API_KEY ||
      this.stoppedPoints
    )
      return;
    this.warmingPoints = true;
    try {
      if (!this.pointsInitialized) {
        const existing = await this.db.$queryRaw<{ storage: string }[]>`
          SELECT storage FROM institution_place_points LIMIT 1`;
        this.pointsInitialized = true;
        // 배포 직후 이미 준비한 보관처를 재사용합니다. 전체 물품을 재집계하지 않습니다.
        this.nextPlaceDiscovery = existing.length ? Date.now() + 900000 : 0;
      }
      if (Date.now() >= this.nextPlaceDiscovery) {
        this.nextPlaceDiscovery = Date.now() + 900000;
        await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL jit = off`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
            await tx.$executeRaw`
            INSERT INTO institution_place_points(storage,retry_at)
            SELECT DISTINCT storage,now() FROM verified_portal_items
            WHERE stored AND day >= ${since()} AND storage <> ''
            UNION SELECT '한성대학교 상상관 글로벌원스톱센터',now()
            ON CONFLICT(storage) DO NOTHING`;
          },
          { timeout: 25000 },
        );
      }
      // 매분에는 작은 보관처 대기열만 읽습니다. 검색할 때마다 수만 물품을
      // 다시 읽어 좌표를 준비하던 작업이 실제 검색과 자원을 다투지 않게 합니다.
      const names = await this.db.$queryRaw<{ storage: string }[]>`
        SELECT storage FROM institution_place_points
        WHERE lat IS NULL AND retry_at <= now()
        ORDER BY (storage = '한성대학교 상상관 글로벌원스톱센터') DESC,retry_at,storage LIMIT 120`;
      await readBatches(
        names.map(({ storage }) => async () => {
          if (this.stoppedPoints) return;
          const query = /한성대학교.*(상상관|원스톱)/u.test(storage)
            ? '한성대학교 상상관'
            : storage;
          const point = await this.storagePoint(query).catch(() => undefined);
          // 실패는 1시간 뒤에 재시도하고, 이미 확인한 좌표는 실패 응답으로 지우지 않습니다.
          await this.db!.$executeRaw`
          INSERT INTO institution_place_points(storage,lat,lng,located_at,retry_at)
          VALUES (${storage},${point?.lat ?? null},${point?.lng ?? null},
            ${point ? new Date() : null},now() + interval '1 hour')
          ON CONFLICT(storage) DO UPDATE SET lat=EXCLUDED.lat,lng=EXCLUDED.lng,
            located_at=EXCLUDED.located_at,retry_at=EXCLUDED.retry_at
          WHERE institution_place_points.lat IS NULL`;
        }),
        4,
      );
    } catch {
      this.logger.warn('보관처 위치는 다음 주기에 다시 준비합니다.');
    } finally {
      this.warmingPoints = false;
    }
  }
  async inventoryTotal() {
    if (!this.db)
      return fail(503, 'EXTERNAL_UNAVAILABLE', '집계를 불러올 수 없어요.');
    const from = since();
    const [members, school, institutions] = await Promise.all([
      this.db.foundItem.count({
        where: {
          archived: false,
          status: { in: ['AVAILABLE', 'RESERVED'] },
          foundAt: { gte: new Date(from + 'T00:00:00+09:00'), lte: new Date() },
        },
      }),
      Promise.resolve()
        .then(() => this.schoolInventory('', 'all'))
        .then((rows) => rows.size)
        .catch(() => null),
      this.db.verifiedPortalItem.count({
        where: { stored: true, day: { gte: from, lte: koreaDay() } },
      }),
    ]);
    return {
      from,
      through: koreaDay(),
      members,
      school,
      institutions,
      total: school === null ? null : members + school + institutions,
    };
  }
  private readonly exhaustedOperations = new Map<string, number>();
  private readonly counts = new Map<string, CountScan>();
  // 동일 기관 상세 요청을 합치고, 만료 시 원본 보관 상태를 다시 읽습니다.
  private cache = new Map<
    string,
    { until: number; observedAt: Date; value: Promise<string> }
  >();
  private schoolReads = Promise.resolve('');
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
    const read = () =>
      this.http
        .request(url.toString(), {
          headers,
          ...(body && { method: 'POST', body }),
          ...(['apis.data.go.kr', 'minwon24.police.go.kr'].includes(
            url.hostname,
          ) && {
            signal: AbortSignal.timeout(9500),
          }),
          ...(url.hostname === 'www.hansung.ac.kr' && {
            signal: AbortSignal.timeout(15000),
          }),
        })
        .then((r) => r.text());
    // 학교 서버가 연속 요청을 끊는 경우가 있어 백그라운드 수집을 천천히 직렬화합니다.
    const school = url.hostname === 'www.hansung.ac.kr';
    const value = school
      ? this.schoolReads
          .catch(() => '')
          .then(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350));
            return read();
          })
      : read();
    if (school) this.schoolReads = value;
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
      1,
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
  private portalUrl(atcId: string, fdSn: string) {
    const url = new URL(
      'https://minwon24.police.go.kr/cvlcpt/selectFindListDetail.do',
    );
    url.search = new URLSearchParams({
      cvlcptId: 'MW-201',
      pkupCmdtyMngId: atcId,
      sortSn: fdSn,
    }).toString();
    return url;
  }

  /** 직접 고른 기간의 끝일 이후 물품을 뺍니다. 다음 페이지 값은 그대로 둡니다. */
  untilDay<T extends { items: InstitutionItem[] }>(result: T, to?: string): T {
    if (!to) return result;
    return { ...result, items: result.items.filter((i) => i.date <= to) };
  }
  /**
   * 가까운 순 정렬용으로 보관처 위치를 찾아 기준 좌표와의 거리를 붙입니다.
   * 보관처 이름을 카카오 장소 검색으로 찾고(응답 캐시), 한 번에 최대 20곳만 확인합니다.
   * 위치를 못 찾은 물품은 거리 없이 그대로 둡니다.
   */
  async withDistances<T extends { items: InstitutionItem[] }>(
    result: T,
    near?: string,
  ): Promise<T> {
    if (!near || !process.env.KAKAO_REST_API_KEY) return result;
    const [lat, lng] = near.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return result;
    const names = [
      ...new Set(result.items.map((i) => i.storage).filter(Boolean)),
    ].slice(0, 20);
    const points = new Map<string, Point>();
    await Promise.all(
      names.map(async (name) => {
        const point = await this.storagePoint(name).catch(() => undefined);
        if (point) points.set(name, point);
      }),
    );
    if (!points.size) return result;
    return {
      ...result,
      items: result.items.map((i) => {
        const point = points.get(i.storage);
        return point
          ? { ...i, distanceM: Math.round(distance({ lat, lng }, point)) }
          : i;
      }),
    };
  }
  private async storagePoint(name: string): Promise<Point | undefined> {
    // "혜화역(4호선)" → "혜화역 4호선"
    const query = name.replace(/\s*\(([^()]+)\)\s*/gu, ' $1 ').trim();
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.search = new URLSearchParams({ query, size: '1' }).toString();
    const json = JSON.parse(
      (
        await this.text(url.href, url, {
          Authorization: 'KakaoAK ' + process.env.KAKAO_REST_API_KEY,
        })
      ).body,
    ) as { documents?: KakaoPlace[] };
    const doc = json.documents?.[0];
    if (!doc) return;
    const point = { lat: Number(doc.y), lng: Number(doc.x) };
    return Number.isFinite(point.lat) && Number.isFinite(point.lng)
      ? point
      : undefined;
  }
  /**
   * 실시간 목록(경찰 등)은 사진 주소가 없어, 저장본에 확인된 사진이 있으면 붙입니다.
   * 보강에 실패해도 목록 응답은 그대로 돌려줍니다.
   */
  async withSavedPhotos<T extends { items: InstitutionItem[] }>(
    result: T,
  ): Promise<T> {
    const ids = result.items
      .filter((i) => !i.photoUrls?.length && i.id.startsWith('lost112:'))
      .map((i) => i.id);
    if (!this.db || !ids.length) return result;
    try {
      const rows = await this.db.verifiedPortalItem.findMany({
        where: { id: { in: ids }, photoUrl: { not: null } },
        select: { id: true, photoUrl: true },
      });
      if (!rows.length) return result;
      const photos = new Map(rows.map((r) => [r.id, r.photoUrl!]));
      return {
        ...result,
        items: result.items.map((i) =>
          photos.has(i.id) && !i.photoUrls?.length
            ? { ...i, photoUrls: [photos.get(i.id)!] }
            : i,
        ),
      };
    } catch {
      return result;
    }
  }
  async publicPhotos(id: string) {
    if (/^hansung:\d{1,12}$/.test(id))
      return (await this.detail(id)).photoUrls ?? [];
    const match = /^lost112:([A-Z0-9]{2,32}):(\d{1,6})$/.exec(id);
    if (!match)
      return fail(404, 'RESOURCE_NOT_FOUND', '기관 물품을 찾을 수 없어요.');
    const [, atcId, fdSn] = match;
    const url = this.portalUrl(atcId, fdSn);
    try {
      // 상세를 연 물품 한 건만 확인합니다. 수집 진도나 검색 집계에는 쓰지 않습니다.
      const row = portalDetail(
        (await this.text(url.href, url)).body,
        atcId,
        fdSn,
      );
      if (clean(row.csteSteNm) !== '보관중' || !row.fdFilePathImg) return [];
      // 확인한 사진 주소를 저장본에도 남겨 다음 목록 응답에서 썸네일로 쓰게 합니다.
      const saved = policePhoto(row.fdFilePathImg, atcId);
      if (saved && this.db)
        await this.db
          .$executeRaw`UPDATE verified_portal_items SET photo_url=${saved}
          WHERE id=${id} AND photo_url IS DISTINCT FROM ${saved}`.catch(
          () => 0,
        );
      return [row.fdFilePathImg];
    } catch {
      return fail(503, 'EXTERNAL_UNAVAILABLE', '기관 사진을 확인할 수 없어요.');
    }
  }
  private async portalRecord(atcId: string, fdSn: string) {
    const url = this.portalUrl(atcId, fdSn);
    const res = await this.text(url.href, url);
    const row = portalDetail(res.body, atcId, fdSn);
    return {
      custodyStatus: row.csteSteNm,
      kindName: row.prdtClNm,
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
  private async publicStation(
    site: Custodian,
    days: string,
    search: ItemSearch,
  ) {
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
              const { item, kindName } = await this.portalRecord(atcId, fdSn);
              records.set(
                id,
                item &&
                  stationKey(item.storage) === stationKey(storage) &&
                  matchesName(
                    search,
                    item.name,
                    kindName || '',
                    ...[
                      fields.PKUP_CMDTY_LCLSF_NM,
                      fields.PKUP_CMDTY_MCLSF_NM,
                    ].map((value) => (value || '').replace(/<(?:HS|HE)>/g, '')),
                  )
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
        '기관에서 이 관리번호의 물품 정보를 찾을 수 없어요.',
      );
    const notStored = (status?: string) =>
      fail(
        404,
        'RESOURCE_NOT_FOUND',
        ['반환완료', '반환', '본인인도', '소유자반환'].includes(
          clean(status ?? ''),
        )
          ? '기관에서 반환을 완료한 물품이에요.'
          : '기관의 보관 중 목록에서 제외된 물품이에요.',
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
      omit: { searchFragments: true },
    });
    const source = saved
      ? saved.source === '경찰'
        ? '경찰'
        : '포털기관'
      : m[1].startsWith('V')
        ? '포털기관'
        : '경찰';
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
            : notStored(publicRecord.custodyStatus);
      }
      if (saved) return saved.stored ? this.savedItem(saved) : notStored();
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
      : notStored(row.csteSteNm);
  }
  savedItem(r: {
    id: string;
    name: string;
    storage: string;
    source: string;
    category: string;
    day: string;
    checkedAt: Date;
    phone?: string | null;
    foundPlace?: string | null;
    photoUrl?: string | null;
  }): InstitutionItem {
    return {
      id: r.id,
      name: r.name,
      storage: r.storage,
      foundPlace: r.foundPlace ?? undefined,
      source:
        r.source === '경찰'
          ? '경찰'
          : r.source === '지하철'
            ? '지하철'
            : '포털기관',
      category: r.category,
      date: r.day,
      dateLabel: '습득일',
      url: policeSite,
      reference: r.id.slice(8).replace(':', ' / '),
      lastVerifiedOn: koreaDay(r.checkedAt.getTime()),
      phone: custodianPhone(r.storage, r.phone),
      // 저장본의 사진 주소는 만료될 수 있어, 화면은 실패 시 아이콘이나 재조회로 대체합니다.
      ...(r.photoUrl && { photoUrls: [r.photoUrl] }),
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
    if (db && row.csteSteNm?.trim()) {
      const stored = clean(row.csteSteNm) === '보관중';
      if (stored && !item) throw Error('Incomplete custody details');
      const id = 'lost112:' + row.atcId + ':' + row.fdSn;
      // 늦게 도착한 이전 보관 응답이 더 최근의 반환 확인을 덮어쓰지 않게 합니다.
      await db.$executeRaw`INSERT INTO verified_portal_items AS old
        (id,name,source,storage,place_key,day,category,stored,checked_at,phone,kind_name,found_place,photo_url)
        VALUES (${id},${item?.name ?? ''},${item?.source ?? source},${item?.storage ?? ''},
          ${stationKey(item?.storage ?? '')},${item?.date ?? (row.fdYmd || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')},${item?.category ?? ''},${stored},${observedAt},${item?.phone ?? null},${row.prdtClNm || null},${row.fdPlace || null},${item?.photoUrls?.[0] ?? null})
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,source=EXCLUDED.source,storage=EXCLUDED.storage,
        place_key=EXCLUDED.place_key,day=EXCLUDED.day,category=EXCLUDED.category,stored=EXCLUDED.stored,checked_at=EXCLUDED.checked_at,phone=EXCLUDED.phone,
        kind_name=COALESCE(EXCLUDED.kind_name,old.kind_name),found_place=COALESCE(EXCLUDED.found_place,old.found_place),
        photo_url=COALESCE(EXCLUDED.photo_url,old.photo_url)
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
      // 역별 목록은 기간 조건을 지원하지 않아 오래된 기록도 포함한다.
      // 넉넉한 묶음으로 읽고 날짜·보관 상태는 기존대로 개별 확인한다.
      numOfRows: station ? '500' : '40',
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
    const variants = lookup.filter(
      (word) =>
        !lookup.some(
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
  private async confirmedSearchPage(
    search: ItemSearch,
    place: string,
    days: string,
    scope: string,
    cursor?: string,
  ) {
    const after = cursor?.match(
      /^v\.([0-9a-f]{12})\.(\d{4}-\d{2}-\d{2})\.(hansung:\d{1,12}|lost112:[a-zA-Z0-9]{1,32}:\d{1,6})$/,
    );
    if (cursor && (!after || after[1] !== scope))
      fail(400, 'VALIDATION_ERROR', '다음 페이지 값이 올바르지 않습니다.');
    const conditions = this.portalWhere(search.q, place, days);
    const where: Prisma.VerifiedPortalItemWhereInput = after
      ? {
          AND: [
            conditions,
            {
              OR: [
                { day: { lt: after[2] } },
                { day: after[2], id: { gt: after[3] } },
              ],
            },
          ],
        }
      : conditions;
    const read = (predicate: Prisma.VerifiedPortalItemWhereInput) =>
      this.db!.verifiedPortalItem.findMany({
        omit: { searchFragments: true },
        where: predicate,
        orderBy: [{ day: 'desc' }, { id: 'asc' }],
        take: 26,
      });
    // 흔한 전국 검색은 최근 일주일만 읽어도 첫 페이지가 찬다. 부족하면 원래 기간 전체를 읽는다.
    const records = async () => {
      if (!cursor && !place && days.toLowerCase() === 'all') {
        const week = await read({
          ...where,
          day: { gte: since('7'), lte: koreaDay() },
        });
        if (week.length === 26) return week;
      }
      return read(where);
    };
    const [rows, school] = await Promise.all([
      records(),
      this.schoolInventory(search.q, days).catch(() => undefined),
    ]);
    if (!school) {
      if (cursor)
        return fail(
          503,
          'EXTERNAL_UNAVAILABLE',
          '학교 목록을 다시 확인해 주세요.',
        );
      return;
    }
    const campus = [...school.values()].filter(
      (item) =>
        matchesPlace(place, item.storage, item.foundPlace) &&
        (!after ||
          item.date < after[2] ||
          (item.date === after[2] && item.id > after[3])),
    );
    const stored = rows.map((row) => this.savedItem(row));
    const items = [...stored, ...campus].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    // 아직 확인한 후보가 하나도 없으면 원본을 확인한 뒤 결과를 돌려준다.
    if (!cursor && !items.length) return;
    if (!cursor)
      this.refreshPortal(
        ['search-page', search, days],
        stored.filter((i) => i.source !== '경찰'),
        async () => {
          const [batch] = await Promise.all([
            this.records('포털기관', search.q, place, days),
            place ? this.publicPlace(search, days, 1) : undefined,
          ]);
          return batch;
        },
      );
    // 목록이 바뀌어도 이전 페이지의 마지막 날짜·관리번호 뒤에서 이어 읽는다.
    const page = items.slice(0, 25),
      last = page.at(-1);
    const live = Buffer.from(
      JSON.stringify([null, [1, 0], [1, liveFirstOffset]]),
    ).toString('base64url');
    return {
      items: page,
      verifiedPage: true,
      notices: [] as string[],
      unavailableSources: [] as Source[],
      nextCursor:
        items.length > 25 && last
          ? ['v', scope, last.date, last.id].join('.')
          : place
            ? 'p.' + scope + '.1.' + live
            : live,
    };
  }
  async search(
    q: string,
    place: string,
    days: string,
    cursor?: string,
    strict = false,
  ) {
    const search = itemSearch(q, place);
    const storagePlace = search.place.replace(
      /^(.+역)\s+([^()]+(?:호선|선))$/u,
      '$1($2)',
    );
    const scope = createHash('sha256')
      .update(JSON.stringify([search, days]))
      .digest('hex')
      .slice(0, 12);
    if (this.db && !strict && (!cursor || cursor.startsWith('v.'))) {
      const page = await this.confirmedSearchPage(
        search,
        storagePlace,
        days,
        scope,
        cursor,
      );
      if (page) return page;
    }
    if (!storagePlace) {
      const result = await this.page(search.q, '', days, false, cursor, strict);
      result.items.sort(
        (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
      );
      return result;
    }
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
    if (!this.db) return this.countSources(search.q, search.place, days);
    const db = this.db;
    const now = Date.now();
    const today = koreaDay(now);
    // 날짜가 바뀌어도 같은 검색 조건은 직전 확정 합계를 찾습니다.
    const queryKey = createHash('sha256')
      .update(JSON.stringify([days, search.q, search.place]))
      .digest('hex');
    const select = {
      total: true,
      policeIncluded: true,
      checkedAt: true,
    } as const;
    const [coverage, previous, confirmedPortal, school] = await Promise.all([
      catalogCoverage(db, since(days, now), today),
      db.lastSearchCount.findUnique({ where: { queryKey }, select }),
      this.verifiedCount(search.q, search.place, days, now),
      this.schoolInventory(search.q, days).catch(() => undefined),
    ]);
    const pending = {
      status: 'counting',
      total: null,
      policeIncluded: coverage.policeIncluded,
      refreshAfterMs: 60000,
    } as const;
    // 수집 중에도 새 검색은 현재 보관 중인 자료를 센다. 직전 확정값은 조회 실패 시 사용한다.
    const confirmedTotal =
      school &&
      confirmedPortal +
        [...school.values()].filter((item) =>
          matchesPlace(search.place, item.storage, item.foundPlace),
        ).length;
    if (!coverage.complete || confirmedTotal === undefined)
      return {
        ...pending,
        confirmedPortal,
        confirmedTotal,
        ...(previous && { lastComplete: previous }),
      };

    const from =
      days === 'all' ? undefined : new Date(now - Number(days) * 86400000);
    const members = await db.foundItem.count({
      where: publicFoundWhere(search, from, undefined, now),
    });
    // 조회 도중 한국 날짜가 바뀌면 서로 다른 날의 결과를 한 합계로 저장하지 않습니다.
    if (koreaDay() !== today) return this.searchTotal(q, place, days);
    const lastComplete = {
      total: members + confirmedTotal,
      checkedAt: new Date(now),
      policeIncluded: coverage.policeIncluded,
    };
    // 느리게 끝난 요청이 더 최근에 확인한 숫자를 덮어쓰지 않게 합니다.
    const written =
      await db.$executeRaw`INSERT INTO last_search_counts AS old (query_key,total,police_included,checked_at)
      VALUES (${queryKey},${lastComplete.total},${lastComplete.policeIncluded},${lastComplete.checkedAt})
      ON CONFLICT (query_key) DO UPDATE SET total=EXCLUDED.total,police_included=EXCLUDED.police_included,checked_at=EXCLUDED.checked_at
      WHERE old.checked_at < EXCLUDED.checked_at`;
    return {
      status: 'complete',
      total: confirmedTotal,
      confirmedPortal,
      confirmedTotal,
      policeIncluded: coverage.policeIncluded,
      refreshAfterMs: 60000,
      lastComplete: written
        ? lastComplete
        : await db.lastSearchCount.findUniqueOrThrow({
            where: { queryKey },
            select,
          }),
    };
  }
  private async countSources(
    q: string,
    place: string,
    days: string,
  ): Promise<CountProgress> {
    const key = JSON.stringify([q, place, days, since(days)]);
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
        total: scan.ids.size,
        policeIncluded: false,
      };
    }
    const current = scan;
    // 한 번에 원본 한 페이지를 확인합니다. 같은 검색은 진행 위치와 요청을 공유합니다.
    current.running = this.search(q, place, days, current.cursor, true)
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
        for (const item of page.items) {
          if (item.source !== '경찰' || (located && item.lastVerifiedOn))
            current.ids.add(item.id);
          else if (current.policeAvailable) current.policeIds.add(item.id);
        }
        if (page.nextCursor) {
          if (page.nextCursor === current.cursor)
            throw Error('Repeated cursor');
          current.cursor = page.nextCursor;
          let confirmedTotal = current.ids.size;
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
            total: current.ids.size,
            policeIncluded: current.policeAvailable,
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
          name: { endsWith: word },
        })),
      }),
      AND: [
        ...brandNameFilter(search),
        ...terms.map((group) => {
          const short: string[] = [];
          const alternatives: Prisma.VerifiedPortalItemWhereInput[] = [];
          for (const word of group) {
            const indexed = /^[가-힣a-z0-9 ]+$/u.test(word);
            if (indexed && word.length <= 3) {
              short.push(word);
              continue;
            }
            const match = {
              contains: likeLiteral(word),
              mode: 'insensitive' as const,
            };
            // 긴 이름은 색인으로 후보를 좁힌 뒤 전체 문자열까지 같은지 확인한다.
            alternatives.push({
              ...(indexed && { searchFragments: { has: word.slice(0, 3) } }),
              OR: [{ name: match }, { kindName: match }],
            });
          }
          if (short.length)
            alternatives.push({ searchFragments: { hasSome: short } });
          return { OR: alternatives };
        }),
      ],
      ...(exact
        ? { placeKey: stationKey(place), source: { not: '경찰' } }
        : place
          ? {
              OR: [
                { placeKey: { contains: likeLiteral(stationKey(place)) } },
                {
                  foundPlace: {
                    contains: likeLiteral(place),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
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
      omit: { searchFragments: true },
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
                saved.items.filter((r) => r.source !== '경찰'),
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
  private schoolSnapshot?: {
    items: Map<string, InstitutionItem>;
    checkedAt: number;
  };
  private schoolRefresh?: Promise<Map<string, InstitutionItem>>;
  private schoolRetryAt = 0;
  private schoolRestore?: Promise<void>;
  private restoreSchool() {
    return (this.schoolRestore ??= (async () => {
      if (!this.db) return;
      const [saved] = await this.db.$queryRaw<
        { items: InstitutionItem[]; checkedAt: Date }[]
      >`
        SELECT items, checked_at AS "checkedAt" FROM institution_school_snapshot WHERE id = 1`;
      if (saved && Array.isArray(saved.items) && !this.schoolSnapshot) {
        this.schoolSnapshot = {
          items: new Map(saved.items.map((item) => [item.id, item])),
          checkedAt: saved.checkedAt.getTime(),
        };
      }
    })().catch(() => undefined));
  }
  schoolSnapshotStale() {
    return (
      !!this.schoolSnapshot &&
      Date.now() - this.schoolSnapshot.checkedAt > 600000
    );
  }
  async schoolForMatching() {
    await this.restoreSchool();
    const snapshot = this.schoolSnapshot;
    if (!snapshot || Date.now() - snapshot.checkedAt >= 300000)
      void this.refreshSchool().catch(() => undefined);
    // 공개 검색은 외부 사이트의 재시도를 기다리지 않습니다.
    // 아직 완성된 저장 목록이 없으면 호출자가 출처 누락을 명시합니다.
    if (!snapshot || Date.now() - snapshot.checkedAt >= 86400000)
      return fail(
        503,
        'EXTERNAL_UNAVAILABLE',
        '학교 저장 목록을 준비 중이에요.',
      );
    const from = since(),
      today = koreaDay();
    return [...snapshot.items.values()].filter(
      (item) => item.date >= from && item.date <= today,
    );
  }
  private async refreshSchool(): Promise<Map<string, InstitutionItem>> {
    await this.restoreSchool();
    const snapshot = this.schoolSnapshot;
    if (snapshot && snapshot.checkedAt + 300000 > Date.now())
      return Promise.resolve(snapshot.items);
    if (this.schoolRefresh) return this.schoolRefresh;
    if (this.schoolRetryAt > Date.now())
      throw Error('School refresh cooling down');
    // 부분 수집이나 오류가 마지막으로 확인한 전체 목록을 덮어쓰지 않게 한다.
    this.schoolRefresh = (async () => {
      const items = new Map<string, InstitutionItem>();
      for (let page = 1; page <= 9999; page++) {
        const result = await this.school('', 'all', page);
        if (result.loadFailed) throw Error('School details unavailable');
        for (const item of result.items) items.set(item.id, item);
        if (!result.limited) {
          this.schoolSnapshot = { items, checkedAt: Date.now() };
          if (this.db) {
            const json = JSON.stringify([...items.values()]);
            await this.db.$executeRaw`
              INSERT INTO institution_school_snapshot(id,items,checked_at)
              VALUES (1,${json}::jsonb,now())
              ON CONFLICT(id) DO UPDATE SET items=EXCLUDED.items,checked_at=EXCLUDED.checked_at`.catch(
              () => undefined,
            );
          }
          return items;
        }
      }
      throw Error('School list incomplete');
    })()
      .catch((error: unknown) => {
        this.schoolRetryAt = Date.now() + 60000;
        throw error;
      })
      .finally(() => {
        this.schoolRefresh = undefined;
      });
    return this.schoolRefresh;
  }
  private async schoolInventory(q: string, days: string) {
    await this.restoreSchool();
    // 이미 확인한 전체 목록을 먼저 읽고 갱신은 뒤에서 진행합니다.
    // 재배포 뒤에도 DB의 마지막 목록을 쓰며, 하루 넘게 오래된 자료는 성공으로 내보내지 않습니다.
    const snapshot = this.schoolSnapshot;
    const items =
      snapshot && Date.now() - snapshot.checkedAt < 86400000
        ? snapshot.items
        : await this.refreshSchool();
    if (snapshot && Date.now() - snapshot.checkedAt >= 300000)
      void this.refreshSchool().catch(() => undefined);
    const search = itemSearch(q),
      from = since(days),
      today = koreaDay();
    return new Map(
      [...items].filter(
        ([, item]) =>
          item.date >= from &&
          item.date <= today &&
          matchesName(search, item.name),
      ),
    );
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
      const publicList = await this.publicStation(
        site,
        query.registeredDays,
        itemSearch(query.q || ''),
      );
      failed ||= publicList.failed;
      if (this.db) {
        const stored = await this.db.verifiedPortalItem.findMany({
          omit: { searchFragments: true },
          where: this.portalWhere(
            query.q || '',
            site.name,
            query.registeredDays,
            true,
            query.category,
          ),
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
      end = koreaDay();
    const located = [...items.values()]
      .filter(
        (i) =>
          i.date >= cutoff &&
          i.date <= end &&
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
    if (this.areas.size >= 32) {
      // 완료된 반경은 새 검색에 자리를 내주고, 실행 중인 작업은 중복 실행하지 않습니다.
      const settled = [...this.areas].find(([, entry]) =>
        Number.isFinite(entry.expires),
      );
      if (!settled) throw Error('Nearby lookup busy');
      this.areas.delete(settled[0]);
    }
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
  async nearbyTotal(query: NearbyDto): Promise<NearbyCount> {
    let area: ReturnType<typeof this.area>;
    try {
      area = this.area(query);
    } catch {
      return { status: 'unavailable', total: null, incomplete: [] };
    }
    if (area.count) return this.nearbyCountResponse(area.count);
    // 날짜와 페이지를 제외해야 자정이나 서버 재시작 후에도 같은 반경을 찾을 수 있습니다.
    const queryKey = createHash('sha256')
      .update(
        JSON.stringify([
          'nearby-v1',
          query.lat,
          query.lng,
          query.radiusM,
          query.category,
          query.registeredDays,
          query.q || '',
        ]),
      )
      .digest('hex');
    const startedAt = new Date(Date.now());
    const db = this.db;
    const job: NearbyCountJob = {
      result: { status: 'counting', total: null, incomplete: [] },
      previous:
        db && this.members
          ? db.lastSearchCount
              .findUnique({ where: { queryKey }, select: { total: true } })
              .then((row) => row?.total ?? null)
              .catch(() => null)
          : Promise.resolve(null),
    };
    area.count = job;
    let confirmedSchool = 0;
    let confirmedStations = 0;
    const publishConfirmed = () => {
      const subtotal = confirmedSchool + confirmedStations;
      if (job.result.status === 'counting' && subtotal > 0)
        job.result = {
          status: 'counting',
          total: null,
          confirmedTotal: subtotal,
          incomplete: [],
        };
    };
    if (this.db) {
      const db = this.db;
      void this.checkedStations(query)
        .then(async (sites) => {
          if (!sites.length) return;
          const where = this.portalWhere(
            query.q || '',
            '',
            query.registeredDays,
            false,
            query.category,
          );
          confirmedStations = await db.verifiedPortalItem.count({
            where: {
              ...where,
              source: { not: '경찰' },
              placeKey: { in: sites.map((s) => stationKey(s.name)) },
            },
          });
          publishConfirmed();
        })
        .catch(() => undefined);
    }
    const school = this.schoolStockInArea(query)
      .then(({ items }) => {
        confirmedSchool = items.length;
        publishConfirmed();
        return confirmedSchool;
      })
      .catch(() => null);
    void Promise.all([area.parts, school])
      .then(async ([parts, school]) => {
        const incomplete: Source[] = [];
        if (school === null) incomplete.push('한성대');
        if (parts[0].notices.length) incomplete.push('경찰');
        if (parts[1].notices.length) incomplete.push('포털기관');
        const agencyTotal = (school ?? 0) + combine(parts).items.length;
        const updated: NearbyCount = {
          total: agencyTotal,
          status: incomplete.length ? 'partial' : 'complete',
          incomplete,
        };
        if (db && this.members) {
          const previous = await job.previous;
          try {
            const memberPage = await this.members.search({
              ...query,
              cursor: undefined,
              limit: 1,
            });
            const combined = memberPage.meta.total + agencyTotal;
            // 기관 오류로 줄어든 부분 합계는 직전 기록을 지우지 않습니다. 정상 확인한 0도 저장합니다.
            updated.lastAreaTotal = incomplete.length
              ? Math.max(previous ?? 0, combined)
              : combined;
            if (!incomplete.length || combined > 0) {
              const written =
                await db.$executeRaw`INSERT INTO last_search_counts AS old (query_key,total,police_included,checked_at)
              VALUES (${queryKey},${combined},${!incomplete.includes('경찰')},${startedAt})
              ON CONFLICT (query_key) DO UPDATE SET total=EXCLUDED.total,police_included=EXCLUDED.police_included,checked_at=EXCLUDED.checked_at
              WHERE old.checked_at < EXCLUDED.checked_at AND (${!incomplete.length} OR old.total <= EXCLUDED.total)`;
              if (!written) {
                const latest = await db.lastSearchCount.findUnique({
                  where: { queryKey },
                  select: { total: true },
                });
                if (latest) updated.lastAreaTotal = latest.total;
              }
            }
          } catch {
            if (previous != null && updated.lastAreaTotal == null)
              updated.lastAreaTotal = previous;
            this.logger.warn('주변 합계 저장을 다음 확인 때 다시 시도합니다.');
          }
        }
        job.result = updated;
        if (incomplete.length)
          area.expires = Math.min(area.expires, Date.now() + 60000);
      })
      .catch(() => {
        job.result = { status: 'unavailable', total: null, incomplete: [] };
      });
    return this.nearbyCountResponse(job);
  }
  private async nearbyCountResponse(job: NearbyCountJob): Promise<NearbyCount> {
    const previous = await job.previous;
    if (job.result.lastAreaTotal != null || previous == null) return job.result;
    return { ...job.result, lastAreaTotal: previous };
  }
  private async schoolStockInArea(query: NearbyDto) {
    const { sites, limited } = await this.places('한성대', query, true);
    const site = sites[0];
    if (!site) {
      if (limited) throw Error('School lookup unavailable');
      return { site, items: [] };
    }
    const inventory = await this.schoolInventory(
      query.q || '',
      query.registeredDays,
    );
    const items = [...inventory.values()].filter(
      (item) => query.category === 'ALL' || item.category === query.category,
    );
    return { site, items };
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
  private async confirmedNearby(
    query: NearbyDto,
    school: Promise<
      Awaited<ReturnType<InstitutionItemsService['nearbySchool']>>
    >,
  ) {
    const [campus, stations] = await Promise.all([
      school,
      this.checkedStations(query),
    ]);
    const checked = await readBatches(
      stations.map((site) => async () => {
        const page = await this.savedPage(
          query.q || '',
          site.name,
          query.registeredDays,
          0,
          [],
          0,
          true,
          query.category,
        );
        const distanceM = Math.round(distance(query, site));
        return page.items.map((item) => ({
          ...item,
          distanceM,
          foundLocation: {
            lat: site.lat,
            lng: site.lng,
            label: '보관처 · ' + item.storage,
          },
        }));
      }),
      3,
    );
    const items = [
      ...new Map(
        [
          ...campus.part.items,
          ...checked.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : [],
          ),
        ].map((item) => [item.id, item]),
      ).values(),
    ].sort(
      (a, b) =>
        a.distanceM - b.distanceM ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    );
    return {
      items: items.slice(0, 25),
      notices: [] as string[],
      nextCursor: null,
      refreshing: true,
    };
  }
  private async checkedStations(query: NearbyDto) {
    const { sites } = await this.places('포털기관', query, true);
    const checked = await readBatches(
      sites
        .filter((s) => /역\s+.+$/u.test(s.name))
        .map(
          (site) => async () =>
            (await this.uniqueStation(site)) ? site : null,
        ),
      3,
    );
    return checked.flatMap((r) =>
      r.status === 'fulfilled' && r.value ? [r.value] : [],
    );
  }
  async nearby(query: NearbyDto) {
    if (query.cursor === 'verified') {
      const initial = Object.assign(new NearbyDto(), query, {
        cursor: undefined,
      });
      const school = this.nearbySchool(initial, 1);
      const full = this.nearbyPage(initial, school);
      if (!this.db) return full;
      // 이미 완성된 반경 목록은 즉시 전달한다. 첫 조회 중에는 검증된 행을 먼저
      // 전달하고 클라이언트가 같은 반경의 최종 목록으로 교체할 수 있게 한다.
      // 한성대 첫 페이지가 있으면 역 이름 대조나 공공기관 전체 조회를 기다리지 않습니다.
      const campus = school
        .then(({ part }) =>
          part.items.length
            ? {
                items: part.items.slice(0, 25),
                notices: part.notices,
                nextCursor: null,
                refreshing: true,
              }
            : full,
        )
        .catch(() => full);
      const warmCampus =
        this.schoolSnapshot &&
        this.schoolSnapshot.checkedAt + 600000 > Date.now()
          ? this.schoolStockInArea(initial)
              .then(({ site, items }) => {
                if (!site || !items.length) return full;
                const distanceM = Math.round(distance(initial, site));
                return {
                  items: items
                    .sort(
                      (a, b) =>
                        b.date.localeCompare(a.date) ||
                        a.id.localeCompare(b.id),
                    )
                    .slice(0, 25)
                    .map((item) => ({
                      ...item,
                      distanceM,
                      foundLocation: {
                        lat: site.lat,
                        lng: site.lng,
                        label: '보관처 · ' + item.storage,
                      },
                    })),
                  notices: [],
                  nextCursor: null,
                  refreshing: true,
                };
              })
              .catch(() => full)
          : full;
      const confirmed = this.confirmedNearby(initial, school)
        .then((page) => (page.items.length ? page : full))
        .catch(() => full);
      return Promise.race([full, warmCampus, campus, confirmed]);
    }
    return this.nearbyPage(query);
  }
  private async nearbyPage(
    query: NearbyDto,
    firstSchool?: ReturnType<InstitutionItemsService['nearbySchool']>,
  ) {
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
      more ? null : (firstSchool ?? this.nearbySchool(query, 1)),
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
