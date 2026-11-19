import type { InstitutionItem } from './institutionItems';
import type { PublicItem, SearchFilters } from './items';

export type SearchSort = 'recent' | 'distance' | 'relevance';
type Item = PublicItem | InstitutionItem;

/** 두 좌표 사이 거리(m). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

/** 기준 좌표에서 물품까지 거리(m). 위치를 모르면 undefined. */
export function distanceOf(item: Item, near: SearchFilters['near']) {
  if (!near) return undefined;
  if (Number.isFinite(item.distanceM)) return item.distanceM;
  if ('source' in item) return item.distanceM;
  return item.point ? Math.round(metersBetween(near, item.point)) : undefined;
}

/** "50m", "1.4km" */
export function formatDistance(m: number) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)}m` : `${(m / 1000).toFixed(1)}km`;
}

const timeOf = (item: Item) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : item.foundAt);

/** 최신순·정확도순은 서버 순서를 보존합니다. 가까운 순만 좌표로 정렬합니다. */
export function sortResults<T extends Item>(items: T[], sort: SearchSort, filters: SearchFilters) {
  const byTime = (a: T, b: T) => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id);
  if (sort === 'distance')
    return [...items].sort((a, b) => {
      const da = distanceOf(a, filters.near);
      const db = distanceOf(b, filters.near);
      if (da === undefined && db === undefined) return byTime(a, b);
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return da - db || byTime(a, b);
    });
  return items;
}
