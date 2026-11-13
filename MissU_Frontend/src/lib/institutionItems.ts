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
export function recentInstitutions(cursor?: string) {
  return mapApi<InstitutionPage>(
    '/institution-items/recent' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
  );
}
export function searchInstitutions(filters: SearchFilters, cursor?: string) {
  const params = new URLSearchParams({
    q: filters.query.trim(),
    place: filters.place.trim(),
    period: filters.period,
  });
  if (cursor) params.set('cursor', cursor);
  return mapApi<InstitutionPage>('/institution-items?' + params);
}
export function nearbyInstitutions(params: string, signal: AbortSignal) {
  return mapApi<Result<NearbyInstitution>>('/institution-items/nearby?' + params, { signal });
}
// 기관 물건은 원문으로 연결합니다. 미슈 회원용 확인 요청에는 기관 관리번호를 보내지 않습니다.
export function openInstitution(item: InstitutionItem) {
  void Linking.openURL(item.url).catch(() => {});
}
