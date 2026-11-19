import { isCurrentLocationLabel } from './placeAddress.ts';
import { api, apiBase, ApiError } from './backend.ts';
import type { ItemCategory } from './activity/types';

export type PublicItem = {
  distanceM?: number;
  createdAt?: string;
  id: string;
  name: string;
  description: string;
  /** Figma 03.G/03.M "종류 · 전자기기" and the 05 registration tiles. */
  category: ItemCategory | 'WALLET_BAG';
  /** Number of public photos (placeholders only; uploads are not connected). */
  photos: number;
  photoUrls?: string[];
  photoUrl?: string;
  statusLabel?: string;
  foundAt: string;
  location: string;
  legacyLocation?: { lat: number; lng: number };
  /** 공개 습득 위치 좌표(가까운 순 정렬용). */
  point?: { lat: number; lng: number };
  storage: string;
  collectionGuide: string;
};
export type SearchFilters = {
  query: string;
  /** 'custom'이면 from~to(YYYY-MM-DD, 서울 날짜)를 씁니다. */
  period: 'all' | '7' | '30' | 'custom';
  place: string;
  from?: string;
  to?: string;
  /** 가까운 순 기준 좌표. 장소 후보를 고르거나 내 위치를 쓰면 채웁니다. */
  near?: { lat: number; lng: number; label: string };
};
/** 검색 조건의 시작·끝 시각(ms). 정해진 기간이 없으면 undefined. */
export function periodRange(filters: SearchFilters, now = Date.now()) {
  if (filters.period === 'custom')
    return {
      from: filters.from ? Date.parse(filters.from + 'T00:00:00+09:00') : undefined,
      to: filters.to ? Date.parse(filters.to + 'T23:59:59.999+09:00') : undefined,
    };
  if (filters.period === 'all') return { from: undefined, to: undefined };
  return { from: now - Number(filters.period) * 86_400_000, to: undefined };
}
// UI fixtures only. No auth state, contact information or private ownership clues.
export const mockItems: PublicItem[] = [
  {
    id: 'buds',
    category: 'ELECTRONICS',
    photos: 1,
    name: '갤럭시 버즈2 (검정)',
    description: '검정 무선 이어폰',
    foundAt: '2026-10-06T14:20:00+09:00',
    location: '중앙도서관 3층 열람실',
    storage: '중앙도서관 1층 안내데스크',
    collectionGuide: '평일 09:00–18:00 · 방문 전 보관 여부 확인',
  },
  {
    id: 'key',
    category: 'KEY',
    photos: 1,
    name: '현대 자동차 키',
    description: '검정 자동차 키',
    foundAt: '2026-10-05T11:30:00+09:00',
    location: '학생식당 앞',
    storage: '학생회관 안내데스크',
    collectionGuide: '평일 09:00–18:00 · 방문 전 보관 여부 확인',
  },
  {
    id: 'wallet',
    category: 'WALLET',
    photos: 1,
    name: '검정 반지갑',
    description: '검정 지갑',
    foundAt: '2026-10-04T16:10:00+09:00',
    location: '공학관 1층',
    storage: '공학관 행정실',
    collectionGuide: '평일 09:00–18:00 · 방문 전 보관 여부 확인',
  },
  {
    id: 'student-id',
    category: 'ID',
    photos: 1,
    name: '학생증',
    description: '학생 신분증',
    foundAt: '2026-10-03T12:00:00+09:00',
    location: '행정실',
    storage: '행정실 안내데스크',
    collectionGuide: '평일 09:00–18:00 · 방문 전 보관 여부 확인',
  },
  {
    id: 'backpack',
    category: 'BAG',
    photos: 1,
    name: '분홍 책가방',
    description: '분홍색 가방',
    foundAt: '2026-10-02T12:00:00+09:00',
    location: '버스 정류장',
    storage: '학생회관 안내데스크',
    collectionGuide: '평일 09:00–18:00 · 방문 전 보관 여부 확인',
  },
];
export function filterItems(items: PublicItem[], filters: SearchFilters, now = Date.now()) {
  const words = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const place = filters.place.trim().toLocaleLowerCase();
  const range = periodRange(filters, now);
  const cutoff = range.from ?? -Infinity;
  const until = range.to ?? Infinity;
  return items.filter((item) => {
    const haystack = `${item.name} ${item.description}`.toLocaleLowerCase();
    const time = new Date(item.foundAt).getTime();
    return (
      words.every((word) => haystack.includes(word)) &&
      item.location.toLocaleLowerCase().includes(place) &&
      time >= cutoff &&
      time <= Math.min(now, until)
    );
  });
}
export type ServerItem = {
  distanceM?: number;
  createdAt?: string;
  id: string;
  name: string;
  publicFeatures: string | null;
  category: 'ELECTRONICS' | 'WALLET_BAG' | 'OTHER';
  foundAt: string;
  foundLocation: { label: string; lat: number; lng: number };
  storagePlace: string;
  pickupGuide: string | null;
  photos: { id: string; url: string }[];
  status: string;
};
export function fromServer(item: ServerItem): PublicItem {
  const photoUrls = item.photos.map((p) => new URL(p.url, apiBase).href);
  return {
    distanceM: item.distanceM,
    id: item.id,
    name: item.name,
    description: item.publicFeatures ?? '',
    category: item.category === 'WALLET_BAG' ? 'WALLET_BAG' : item.category,
    photos: item.photos.length,
    photoUrls,
    photoUrl: photoUrls[0],
    foundAt: item.foundAt,
    createdAt: item.createdAt,
    location: item.foundLocation.label,
    ...(Number.isFinite(item.foundLocation.lat) &&
      Number.isFinite(item.foundLocation.lng) && {
        point: { lat: item.foundLocation.lat, lng: item.foundLocation.lng },
      }),
    ...(isCurrentLocationLabel(item.foundLocation.label) &&
      Number.isFinite(item.foundLocation.lat) &&
      Number.isFinite(item.foundLocation.lng) && {
        legacyLocation: { lat: item.foundLocation.lat, lng: item.foundLocation.lng },
      }),
    storage: item.storagePlace,
    collectionGuide: item.pickupGuide ?? '',
    statusLabel:
      item.status === 'AVAILABLE'
        ? '보관 중'
        : item.status === 'RESERVED'
          ? '반환 진행 중'
          : '반환 완료',
  };
}
export const itemRepository = {
  async recentPage(cursor?: string) {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const page = await api<{ data: ServerItem[]; meta: { nextCursor: string | null } }>(
      '/items?' + params.toString(),
    );
    return { items: page.data.map(fromServer), nextCursor: page.meta.nextCursor };
  },
  async searchPage(filters: SearchFilters, cursor?: string, searchTime = Date.now()) {
    const q = new URLSearchParams({ limit: '50' });
    if (cursor) q.set('cursor', cursor);
    if (filters.query.trim()) q.set('q', filters.query.trim());
    if (filters.place.trim()) q.set('place', filters.place.trim());
    const range = periodRange(filters, searchTime);
    if (range.from !== undefined) q.set('foundFrom', new Date(range.from).toISOString());
    if (range.to !== undefined) q.set('foundTo', new Date(range.to).toISOString());
    const page = await api<{
      data: ServerItem[];
      meta: { total?: number; nextCursor: string | null };
    }>('/items?' + q.toString());
    return { items: page.data.map(fromServer), ...page.meta };
  },
  async find(id: string): Promise<PublicItem | undefined> {
    try {
      return fromServer((await api<{ data: ServerItem }>('/items/' + encodeURIComponent(id))).data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return undefined;
      throw e;
    }
  },
};
export function formatFoundAt(value: string) {
  // Explicit Seoul time, independent of the test device's time zone.
  const d = new Date(new Date(value).getTime() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
