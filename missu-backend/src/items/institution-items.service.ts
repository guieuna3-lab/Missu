import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { fail } from '../common/http';
import { ExternalHttpService } from '../integrations/external-http.service';
import { NearbyDto } from './nearby.dto';
import {
  clean,
  distance,
  governmentItem,
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
  지하철: { base: 'LosPtfundInfoInqireService', prefix: 'getPtLosfund' },
} as const;
type Provider = keyof typeof government;
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
const railStorage =
  /역(?:\s*\(|$)|호선|지하철|도시철도|교통공사|경전철|메트로|역무실|전철/u;
const storageRank = (name: string) =>
  railStorage.test(name) ? 2 : /유실물센터/u.test(name) ? 1 : 0;
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
const sourceList: Source[] = ['한성대', '경찰', '지하철'];
const since = (days: string) =>
  /^(7|30)$/.test(days)
    ? new Date(Date.now() + (9 * 3600 - (Number(days) - 1) * 86400) * 1000)
        .toISOString()
        .slice(0, 10)
    : '';
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
export class InstitutionItemsService implements OnModuleDestroy {
  constructor(
    private readonly http: ExternalHttpService,
    @Optional() private readonly db?: DatabaseService,
  ) {}
  private walletWorker?: Promise<void>;
  private stopping = false;
  onModuleDestroy() {
    this.stopping = true;
  }
  private readonly counts = new Map<string, CountScan>();
  // 동일 기관 상세 요청을 합치고, 만료 시 원본 보관 상태를 다시 읽습니다.
  private cache = new Map<string, { until: number; value: Promise<string> }>();
  private text(key: string, url: URL, headers?: Record<string, string>) {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    if (this.cache.size >= 400)
      this.cache.delete(this.cache.keys().next().value!);
    const value = this.http
      .request(url.toString(), {
        headers,
        ...(url.hostname === 'apis.data.go.kr' && {
          signal: AbortSignal.timeout(9500),
        }),
      })
      .then((r) => r.text());
    this.cache.set(key, { until: Date.now() + 120000, value });
    void value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }
  private async school(q: string, days: string, page = 1) {
    const url = new URL(
      'https://www.hansung.ac.kr/bbs/onestop/1718/artclList.do',
    );
    url.searchParams.set('page', String(page));
    if (q) {
      url.searchParams.set('findType', 'sj');
      url.searchParams.set('findWord', q);
    }
    if (since(days)) url.searchParams.set('rgsBgndeStr', since(days));
    return schoolPage(await this.text(url.href, url), page);
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
      return (await this.list('지하철', 'InfoAccTpNmCstdyPlace', params)).total;
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
    return policePage(await this.text(cacheId, url));
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
    const station = source === '지하철' && site?.name.match(/^(.+역)\s+(.+)$/u);
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
    // 포털 첫 페이지에는 공항과 상점도 섞여 있어, 장소를 입력하지 않은
    // 검색에서는 역과 유실물센터 목록도 함께 읽고 같은 관리번호를 합칩니다.
    const globalRail = source === '지하철' && !place && !site;
    const requests = [() => this.list(source, operation, filters)];
    if (globalRail) {
      // 명칭 조회는 기관별로 결과가 몰릴 수 있어 노선과 센터 목록을 함께 순회합니다.
      for (const venue of [
        '역',
        '유실물센터',
        '호선',
        ...Array.from({ length: 9 }, (_, i) => i + 1 + '호선'),
      ]) {
        requests.push(() =>
          this.list(source, 'InfoAccTpNmCstdyPlace', {
            ...(q ? { PRDT_NM: q } : {}),
            DEP_PLACE: venue,
            numOfRows: '40',
            pageNo: String(pageNo),
          }),
        );
      }
    }
    // 공급자가 동시 호출을 지연시키더라도 핵심 목록 요청이 먼저 처리되게 합니다.
    const settled = await readBatches(requests, 4);
    const pages = settled.flatMap((p) =>
      p.status === 'fulfilled' ? [p.value] : [],
    );
    if (!pages.length) throw Error('Source unavailable');
    // 목록에서는 일부 결과를 제공할 수 있지만 전체 건수에는 누락된 응답을 허용하지 않습니다.
    if (
      strict &&
      (pages.length !== requests.length ||
        pages.some(
          (p) =>
            p.total === null ||
            (p.limited && pageNo >= 9999) ||
            (p.total > 0 && !p.records.length && pageNo === 1),
        ))
    )
      throw Error('Incomplete agency list');
    const records = [
      ...new Map(
        pages.flatMap((p) => p.records).map((r) => [r.atcId + ':' + r.fdSn, r]),
      ).values(),
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
    candidates.sort((a, b) => {
      const byDate = (b.fdYmd || '')
        .replaceAll('-', '')
        .localeCompare((a.fdYmd || '').replaceAll('-', ''));
      if (!globalRail) return byDate;
      const byStorage = storageRank(b.depPlace) - storageRank(a.depPlace);
      return recent ? byDate || byStorage : byStorage || byDate;
    });
    const shortlist = globalRail
      ? candidates.filter((r) => storageRank(r.depPlace) > 0)
      : candidates;
    if (globalRail && !recent) {
      // 같은 보관처의 두 번째 물품보다 다른 보관처의 첫 물품을 먼저 확인합니다.
      const seen = new Map<string, number>();
      const ranks = new Map<Record<string, string>, number>();
      for (const row of shortlist) {
        const storage = clean(row.depPlace);
        const rank = seen.get(storage) || 0;
        ranks.set(row, rank);
        seen.set(storage, rank + 1);
      }
      shortlist.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
    }
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
        if (!current) throw Error('Missing detail');
        if (site && clean(current.depPlace || '') !== clean(row.depPlace))
          return;
        return governmentItem({ ...row, ...current }, source);
      }),
      8,
    );
    const items = checked.flatMap((r) =>
      r.status === 'fulfilled' && r.value ? [r.value] : [],
    );
    const loadFailed =
      pages.length < requests.length ||
      checked.some((r) => r.status === 'rejected');
    if (strict && loadFailed) throw Error('Incomplete agency details');
    return {
      items,
      loadFailed,
      next:
        offset + limit < shortlist.length
          ? [pageNo, offset + limit]
          : pages.some((p) => p.limited) && pageNo < 9999
            ? [pageNo + 1, 0]
            : null,
      limited:
        loadFailed ||
        pages.some((p) => p.limited) ||
        shortlist.length > offset + limit,
    };
  }
  // 이미 승인된 포털 키를 사용하며, 이용자의 조회를 위해 일일 상세 호출 여유를 남깁니다.
  private async updateWalletSnapshot(db: DatabaseService) {
    const query = '지갑';
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
            const getPage = (n: number) =>
              this.list('지하철', 'InfoAccTpNmCstdyPlace', {
                PRDT_NM: query,
                numOfRows: '1000',
                pageNo: String(n),
              });
            const pageNumbers = Array.from(
              {
                length:
                  job.listTotal === null
                    ? 1
                    : Math.min(
                        3,
                        Math.ceil(job.listTotal / 1000) - job.page + 1,
                      ),
              },
              (_, i) => job.page + i,
            );
            const responses = await Promise.allSettled(
              pageNumbers.map(getPage),
            );
            for (const [index, response] of responses.entries()) {
              if (response.status === 'rejected') return defer(30000);
              const p = response.value,
                page = pageNumbers[index];
              if (
                p.total === null ||
                p.page !== page ||
                p.size !== 1000 ||
                p.records.length !==
                  Math.max(0, Math.min(1000, p.total - (page - 1) * 1000))
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
              const candidates = p.records.filter(
                (r) => r.atcId && r.fdSn && storageRank(r.depPlace || '') > 0,
              );
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
              if (!p.limited) break;
            }
            return true;
          }
          const candidates = await tx.agencyCountCandidate.findMany({
            where: { ...scope, stored: null },
            select: { atcId: true, fdSn: true },
            orderBy: [{ atcId: 'asc' }, { fdSn: 'asc' }],
            take: 24,
          });
          if (!candidates.length) {
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
          if (budget.calls + candidates.length > 8000) return defer(15 * 60000);
          await tx.agencyCountBudget.update({
            where: { day },
            data: { calls: { increment: candidates.length } },
          });
          const checks = await readBatches(
            candidates.map(({ atcId, fdSn }) => async () => {
              const response = await this.list('지하철', 'DetailInfo', {
                ATC_ID: atcId,
                FD_SN: fdSn,
              });
              const row = response.records.find(
                (r) => r.atcId === atcId && r.fdSn === fdSn,
              );
              if (
                !row?.csteSteNm ||
                !row.depPlace ||
                !row.fdPrdtNm ||
                !row.fdYmd
              )
                throw Error('Incomplete custody record');
              return { atcId, fdSn, stored: !!governmentItem(row, '지하철') };
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
                data: { stored },
              });
          }
          if (checks.some((c) => c.status === 'rejected')) return defer(30000);
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
        where: { query: '지갑' },
        create: { query: '지갑' },
        update: {},
      });
      if (row.retryAt.getTime() <= Date.now() && !this.walletWorker) {
        this.walletWorker = this.updateWalletSnapshot(this.db)
          .catch(() => undefined)
          .finally(() => {
            this.walletWorker = undefined;
          });
      }
      if (!row.completedAt || row.total === null)
        return { status: 'counting', total: null };
      snapshot = {
        total: row.total,
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
      // 승인 여부만 다시 확인합니다. 이미 집계한 학교·지하철 목록은 다시 읽지 않습니다.
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
        // 두 기관의 관리번호가 겹치면 지하철 집계에서 이미 센 물품입니다.
        const overlaps =
          snapshot && police.length && this.db
            ? await this.db.agencyCountCandidate.findMany({
                where: {
                  query: '지갑',
                  generation: snapshot.generation,
                  stored: true,
                  OR: police.map((i) => {
                    const [, atcId, fdSn] = i.id.split(':');
                    return { atcId, fdSn };
                  }),
                },
                select: { atcId: true, fdSn: true },
              })
            : [];
        const railIds = new Set(
          overlaps.map((i) => 'lost112:' + i.atcId + ':' + i.fdSn),
        );
        for (const item of page.items) {
          if (item.source !== '경찰') current.ids.add(item.id);
          else if (current.policeAvailable && !railIds.has(item.id))
            current.policeIds.add(item.id);
        }
        if (page.nextCursor) {
          if (page.nextCursor === current.cursor)
            throw Error('Repeated cursor');
          current.cursor = page.nextCursor;
        } else {
          // 경찰과 지하철에 동시에 있는 관리번호는 한 번만 셉니다.
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
            (p) =>
              p === null ||
              (Array.isArray(p) &&
                p.length === 2 &&
                Number.isInteger(p[0]) &&
                p[0] >= 1 &&
                p[0] <= 9999 &&
                Number.isInteger(p[1]) &&
                p[1] >= 0 &&
                p[1] <= 1000),
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
          if (source === '한성대') {
            const batch = await this.school(q, days, pos[0]);
            if (strict && batch.limited && pos[0] >= 9999)
              throw Error('Incomplete school board');
            next[i] = batch.limited && pos[0] < 9999 ? [pos[0] + 1, 0] : null;
            return { items: batch.items };
          }
          const batch = await this.records(
            source,
            q,
            place,
            days,
            undefined,
            recent,
            pos,
            strict,
          );
          next[i] = batch.next ?? null;
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
        await this.text(url.href, url, {
          Authorization: 'KakaoAK ' + process.env.KAKAO_REST_API_KEY,
        }),
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
        const stations = source === '지하철' && term === '지하철역';
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
          await this.text(url.href, url, { Authorization: 'KakaoAK ' + key }),
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
            source === '지하철' &&
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
  async nearby(query: NearbyDto) {
    const parts = await Promise.all(
      sourceList.map((source) =>
        this.part<Located>(source, async () => {
          if (source !== '한성대' && !process.env.DATA_GO_KR_SERVICE_KEY)
            throw Error('Agency access pending');
          const { sites, limited } = await this.places(source, query);
          const pages = await Promise.allSettled(
            sites.map(async (site) => {
              const batch =
                source === '한성대'
                  ? await this.school(query.q || '', query.registeredDays)
                  : await this.records(
                      source,
                      query.q || '',
                      '',
                      query.registeredDays,
                      site,
                    );
              const items = batch.items
                .filter(
                  (i) =>
                    i.date >= since(query.registeredDays) &&
                    (query.category === 'ALL' || i.category === query.category),
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
    const result = combine(parts);
    result.items.sort(
      (a, b) => a.distanceM - b.distanceM || b.date.localeCompare(a.date),
    );
    return result;
  }
}
