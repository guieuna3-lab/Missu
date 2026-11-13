import { Linking } from 'react-native';
import { mapApi, type Coordinates } from '../features/nearby/mapData';
import type { SearchFilters } from './items';

export type InstitutionItem = {
  id: string;
  name: string;
  source: '경찰' | '지하철' | '한성대';
  date: string;
  dateLabel: '게시일' | '습득일';
  storage: string;
  reference: string;
  url: string;
  category: string;
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
    if (!page.items.length || page.notices.some((n) => n.includes('지하철 자료를 현재'))) forget();
  }, forget);
  return value;
}
export function previewInstitutions(filters?: SearchFilters) {
  const params = new URLSearchParams();
  if (filters) {
    params.set('q', filters.query.trim());
    params.set('place', filters.place.trim());
    params.set('period', filters.period);
  }
  return mapApi<{ items: InstitutionItem[] }>('/institution-items/preview?' + params);
}
export function recentInstitutions(cursor?: string) {
  return firstPage(
    '/institution-items/recent' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    cursor,
  );
}
export function searchInstitutions(filters: SearchFilters, cursor?: string) {
  const params = new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period,
  });
  if (cursor) params.set('cursor', cursor);
  return firstPage('/institution-items?' + params, cursor);
}
export function portalRegistrations(filters: SearchFilters) {
  const params = new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period,
  });
  return mapApi<{ total: number | null }>('/institution-items/registrations?' + params);
}
export function nearbyInstitutions(params: string, signal: AbortSignal) {
  return mapApi<Result<NearbyInstitution>>('/institution-items/nearby?' + params, { signal });
}
// 기관 물건은 원문으로 연결합니다. 미슈 회원용 확인 요청에는 기관 관리번호를 보내지 않습니다.
export function openInstitution(item: InstitutionItem) {
  void Linking.openURL(item.url).catch(() => {});
}
