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
  ): Promise<Batch> {
    const road = site && roadKey(site.address);
    if (site && !road) return { items: [], limited: true };
    const filters: Record<string, string> = { numOfRows: '40', pageNo: '1' };
    if (q) filters.PRDT_NM = q;
    if (site) {
      filters.ADDR = site.address.match(
        /[가-힣A-Za-z0-9·.]+(?:로|길|대로)\s+(?:지하\s*)?\d+(?:-\d+)?/u,
      )![0];
    } else if (place) filters.DEP_PLACE = place;
    const page = await this.list(
      source,
      site ? 'InfoAccToLc' : 'InfoAccTpNmCstdyPlace',
      filters,
    );
    const cutoff = since(days);
    const candidates = page.records.filter((row) => {
      if (!row.atcId || !row.fdSn || !row.depPlace) return false;
      if (
        cutoff &&
        (row.fdYmd || '').replaceAll('-', '') < cutoff.replaceAll('-', '')
      )
        return false;
      if (!site) return true;
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
    const checked = await Promise.allSettled(
      candidates.slice(0, 8).map(async (row) => {
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
        page.limited ||
        candidates.length > 8 ||
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
        const url = new URL(
          'https://dapi.kakao.com/v2/local/search/keyword.json',
        );
        url.search = new URLSearchParams({
          query: term,
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
