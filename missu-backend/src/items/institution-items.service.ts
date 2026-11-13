import { Injectable } from '@nestjs/common';
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
type Result<T> = { items: T[]; notices: string[] };
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
export class InstitutionItemsService {
  constructor(private readonly http: ExternalHttpService) {}
  // 동일 기관 상세 요청을 합치고, 만료 시 원본 보관 상태를 다시 읽습니다.
  private cache = new Map<string, { until: number; value: Promise<string> }>();
  private text(key: string, url: URL, headers?: Record<string, string>) {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    if (this.cache.size >= 400)
      this.cache.delete(this.cache.keys().next().value!);
    const value = this.http
      .request(url.toString(), { headers })
      .then((r) => r.text());
    this.cache.set(key, { until: Date.now() + 120000, value });
    void value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }
  private async school(q: string, days: string) {
    const url = new URL(
      'https://www.hansung.ac.kr/bbs/onestop/1718/artclList.do',
    );
    url.searchParams.set('page', '1');
    if (q) {
      url.searchParams.set('findType', 'sj');
      url.searchParams.set('findWord', q);
    }
    if (since(days)) url.searchParams.set('rgsBgndeStr', since(days));
    return schoolPage(await this.text(url.href, url));
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
  ): Promise<Batch> {
    const station = source === '지하철' && site?.name.match(/^(.+역)\s+(.+)$/u);
    // 다른 도시의 동명·동일 호선 역은 기관 이름만으로 지도에 배치할 수 없습니다.
    if (station && site && !(await this.uniqueStation(site, station[1])))
      return { items: [], limited: true };
    const road = site && roadKey(site.address);
    if (site && !station && !road) return { items: [], limited: true };
    const filters: Record<string, string> = { numOfRows: '40', pageNo: '1' };
    if (q) filters.PRDT_NM = q;
    let operation = 'InfoAccTpNmCstdyPlace';
    if (recent) {
      operation = 'InfoAccToClAreaPd';
      filters.START_YMD = since('30').replaceAll('-', '');
      filters.END_YMD = new Date(Date.now() + 9 * 3600000)
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '');
      filters.numOfRows = '100';
    } else if (station) {
      filters.DEP_PLACE = station[1];
    } else if (site) {
      operation = 'InfoAccToLc';
      filters.ADDR = site.address.match(
        /[가-힣A-Za-z0-9·.]+(?:로|길|대로)\s+(?:지하\s*)?\d+(?:-\d+)?/u,
      )![0];
    } else if (place) filters.DEP_PLACE = place;
    // 포털 첫 페이지에는 공항과 상점도 섞여 있어, 장소를 입력하지 않은
    // 검색에서는 역과 유실물센터 목록도 함께 읽고 같은 관리번호를 합칩니다.
    const globalRail = source === '지하철' && !place && !site;
    const requests = [this.list(source, operation, filters)];
    if (globalRail) {
      for (const venue of ['역', '유실물센터']) {
        requests.push(
          this.list(source, 'InfoAccTpNmCstdyPlace', {
            ...(q ? { PRDT_NM: q } : {}),
            DEP_PLACE: venue,
            numOfRows: '80',
            pageNo: '1',
          }),
        );
      }
    }
    const settled = await Promise.allSettled(requests);
    const pages = settled.flatMap((p) =>
      p.status === 'fulfilled' ? [p.value] : [],
    );
    if (!pages.length) throw Error('Source unavailable');
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
    const limit = recent || globalRail ? 12 : 8;
    const checked = await Promise.allSettled(
      shortlist.slice(0, limit).map(async (row) => {
        const detail = await this.list(source, 'DetailInfo', {
          ATC_ID: row.atcId,
          FD_SN: row.fdSn,
        });
        const current = detail.records.find(
          (x) => x.atcId === row.atcId && x.fdSn === row.fdSn,
        );
        if (
          !current ||
          (site && clean(current.depPlace || '') !== clean(row.depPlace))
        )
          return;
        return governmentItem({ ...row, ...current }, source);
      }),
    );
    const items = checked.flatMap((r) =>
      r.status === 'fulfilled' && r.value ? [r.value] : [],
    );
    return {
      items,
      limited:
        pages.length < requests.length ||
        pages.some((p) => p.limited) ||
        shortlist.length > limit ||
        checked.some((r) => r.status === 'rejected'),
    };
  }
  private async part<T extends InstitutionItem>(
    source: Source,
    run: () => Promise<{ items: T[]; limited: boolean }>,
  ): Promise<Result<T>> {
    try {
      const { items, limited } = await run();
      return {
        items,
        notices: limited ? [source + ' 자료는 일부만 표시해요.'] : [],
      };
    } catch {
      return {
        items: [],
        notices: [source + ' 자료를 현재 조회할 수 없어요.'],
      };
    }
  }
  async search(q: string, place: string, days: string) {
    const result = combine(
      await Promise.all(
        sourceList.map((source) =>
          this.part(source, () =>
            source === '한성대'
              ? this.school(q, days)
              : this.records(source, q, place, days),
          ),
        ),
      ),
    );
    result.items = result.items
      .filter(
        (x) =>
          x.date >= since(days) &&
          (!place || clean(x.storage).includes(clean(place))),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }
  async recent() {
    const result = combine(
      await Promise.all(
        sourceList.map((source) =>
          this.part(source, () =>
            source === '한성대'
              ? this.school('', 'all')
              : this.records(source, '', '', '30', undefined, true),
          ),
        ),
      ),
    );
    result.items = result.items
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
      .slice(0, 3);
    return result;
  }
  private async uniqueStation(site: Custodian, name: string) {
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.search = new URLSearchParams({
      query: name,
      category_group_code: 'SW8',
      size: '15',
    }).toString();
    const json = JSON.parse(
      await this.text(url.href, url, {
        Authorization: 'KakaoAK ' + process.env.KAKAO_REST_API_KEY,
      }),
    ) as { documents: KakaoPlace[]; meta?: { is_end: boolean } };
    const matches = json.documents.filter(
      (p) => stationKey(p.place_name) === stationKey(site.name),
    );
    return (
      json.meta?.is_end === true &&
      matches.length === 1 &&
      distance(site, { lat: Number(matches[0].y), lng: Number(matches[0].x) }) <
        100
    );
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
