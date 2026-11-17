import type { InstitutionItem } from './institutionItems';
import type { PublicItem, SearchFilters } from './items';

export type SearchSort = 'recent' | 'distance' | 'relevance';
type Item = PublicItem | InstitutionItem;

const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, '');

/**
 * 검색어와 물품명이 얼마나 맞는지 점수(0~100)를 매깁니다.
 * 완전 일치 > 앞부분 일치 > 검색어 전체 포함 > 단어별 포함 비율 순입니다.
 */
export function relevance(name: string, query: string) {
  const target = normalize(name);
  const whole = normalize(query);
  if (!whole) return 0;
  if (target === whole) return 100;
  if (target.startsWith(whole)) return 85;
  if (target.includes(whole)) return 70;
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.filter((w) => target.includes(w)).length;
  return words.length ? Math.round((hits / words.length) * 60) : 0;
}

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
  if ('source' in item) return item.distanceM;
  return item.point ? Math.round(metersBetween(near, item.point)) : undefined;
}

/** "50m", "1.4km" */
export function formatDistance(m: number) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)}m` : `${(m / 1000).toFixed(1)}km`;
}

const timeOf = (item: Item) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : (item.createdAt ?? item.foundAt));

/** 불러온 결과를 정렬합니다. 같은 점수·거리는 최신순으로 둡니다. */
export function sortResults<T extends Item>(items: T[], sort: SearchSort, filters: SearchFilters) {
  const byTime = (a: T, b: T) => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id);
  if (sort === 'relevance')
    return [...items].sort(
      (a, b) => relevance(b.name, filters.query) - relevance(a.name, filters.query) || byTime(a, b),
    );
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
