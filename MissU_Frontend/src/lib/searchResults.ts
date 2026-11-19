import { api } from './backend.ts';
import { fromServer, type ServerItem, type SearchFilters } from './items.ts';
import type { InstitutionItem } from './institutionItems';

/** 회원·학교·포털의 전체 검색 대상을 서버에서 정렬한 25건을 받습니다. */
export async function searchResults(
  filters: SearchFilters,
  sort: 'recent' | 'relevance',
  cursor?: string,
) {
  const query = new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period === 'custom' ? 'all' : filters.period,
    sort,
  });
  if (filters.period === 'custom') {
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
  }
  if (cursor) query.set('cursor', cursor);
  const { data } = await api<{
    data: {
      items: (ServerItem | InstitutionItem)[];
      nextCursor: string | null;
      memberTotal?: number;
    };
  }>('/search-items?' + query);
  return { ...data, items: data.items.map((item) => ('source' in item ? item : fromServer(item))) };
}
