import { router } from 'expo-router';
import { mapApi, type Coordinates } from '../features/nearby/mapData';
import type { SearchFilters } from './items';

export type InstitutionItem = {
  id: string;
  name: string;
  source: '경찰' | '지하철' | '한성대' | '포털기관';
  date: string;
  lastVerifiedOn?: string;
  dateLabel: '게시일' | '습득일';
  storage: string;
  reference: string;
  url: string;
  category: string;
  phone?: string;
  foundPlace?: string;
};
type NearbyInstitution = InstitutionItem & {
  foundLocation: Coordinates & { label: string };
  distanceM: number;
};
type Result<T> = { items: T[]; notices: string[] };
type InstitutionPage = Result<InstitutionItem> & { nextCursor: string | null };
// 같은 화면을 다시 열 때만 짧게 재사용합니다. 오류 응답은 다음 조회에서 다시 확인합니다.
const pages = new Map<string, { until: number; value: Promise<InstitutionPage> }>();
function firstPage(path: string, cursor?: string) {
  if (cursor) return mapApi<InstitutionPage>(path);
  const entry = pages.get(path);
  if (entry && Date.now() < entry.until) return entry.value;
  if (pages.size >= 16) pages.delete(pages.keys().next().value!);
  const value = mapApi<InstitutionPage>(path);
  pages.set(path, { until: Date.now() + 30000, value });
  const forget = () => {
    if (pages.get(path)?.value === value) pages.delete(path);
  };
  void value.then((page) => {
    if (
      !page.items.length ||
      page.notices.some((n) => n.startsWith('포털기관 ') || n.startsWith('지하철 '))
    )
      forget();
  }, forget);
  return value;
}
export function previewInstitutions() {
  return mapApi<{ items: InstitutionItem[] }>('/institution-items/preview');
}
export function recentInstitutions(cursor?: string) {
  return firstPage(
    '/institution-items/recent' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    cursor,
  );
}
function institutionQuery(filters: SearchFilters) {
  return new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period,
  });
}
export function searchInstitutions(filters: SearchFilters, cursor?: string) {
  const params = institutionQuery(filters);
  if (cursor) params.set('cursor', cursor);
  return firstPage('/institution-items?' + params, cursor);
}
export type InstitutionTotal = {
  status: 'counting' | 'complete' | 'unavailable';
  total: number | null;
  policeIncluded?: boolean;
  checkedAt?: string;
  progress?: { stage: 'listing' | 'checking'; checked: number; candidates: number };
};
export function institutionTotal(filters: SearchFilters, signal: AbortSignal) {
  return mapApi<InstitutionTotal>('/institution-items/search-total?' + institutionQuery(filters), {
    signal,
  });
}
export function nearbyInstitutions(params: string, signal: AbortSignal) {
  return mapApi<Result<NearbyInstitution>>('/institution-items/nearby?' + params, { signal });
}
// 카드와 공유 링크가 같은 상세 주소를 사용합니다. 보관 상태는 서버에서 다시 확인합니다.
export function openInstitution(item: InstitutionItem) {
  router.push({ pathname: '/items/[id]', params: { id: item.id } });
}
export function institutionDetail(id: string) {
  return mapApi<InstitutionItem>('/institution-items/detail/' + encodeURIComponent(id));
}
