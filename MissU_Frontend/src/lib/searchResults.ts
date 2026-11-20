import { api } from './backend.ts';
import { fromServer, type ServerItem, type SearchFilters } from './items.ts';
import type { InstitutionItem } from './institutionItems';
import type { SearchSort } from './searchRank';

export type SearchCount = { total: number; checkedAt: string; notices: string[] };
function queryFor(filters: SearchFilters) {
  const query = new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period === 'custom' ? 'all' : filters.period,
  });
  if (filters.period === 'custom') {
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
  }
  return query;
}
export async function searchCount(filters: SearchFilters, signal: AbortSignal) {
  const { data } = await api<{ data: SearchCount }>('/search-items/count?' + queryFor(filters), {
    signal,
  });
  return data;
}
type SearchPage = {
  items: PublicRow[];
  nextCursor: string | null;
  memberTotal?: number;
  notices?: string[];
};
type PublicRow = ServerItem | InstitutionItem;
async function page(path: string) {
  const { data } = await api<{ data: SearchPage }>(path);
  return { ...data, items: data.items.map((item) => ('source' in item ? item : fromServer(item))) };
}
type RecentPage = Awaited<ReturnType<typeof page>>;
let recentPage: { value: RecentPage; until: number } | undefined;
let recentRequest: Promise<RecentPage> | undefined;
/** 잠깐 다른 탭에 다녀와도 마지막 통합 목록을 바로 표시합니다. 기기에는 저장하지 않습니다. */
export function cachedRecentResults() {
  return recentPage && recentPage.until > Date.now() ? recentPage.value : undefined;
}
export function recentResults(cursor?: string): Promise<RecentPage> {
  if (cursor) return page('/search-items/recent?cursor=' + encodeURIComponent(cursor));
  // 화면 전환 도중 겹친 요청은 공유하며, 실패한 응답이나 다음 페이지는 보관하지 않습니다.
  if (recentRequest) return recentRequest;
  recentRequest = page('/search-items/recent')
    .then((result) => {
      recentPage = { value: result, until: Date.now() + 60000 };
      return result;
    })
    .finally(() => {
      recentRequest = undefined;
    });
  return recentRequest;
}

/** 회원·학교·포털의 전체 검색 대상을 서버에서 정렬한 25건을 받습니다. */
export async function searchResults(filters: SearchFilters, sort: SearchSort, cursor?: string) {
  const query = queryFor(filters);
  query.set('sort', sort);
  if (sort === 'distance' && filters.near)
    query.set('near', filters.near.lat.toFixed(6) + ',' + filters.near.lng.toFixed(6));
  if (cursor) query.set('cursor', cursor);
  return page('/search-items?' + query);
}
