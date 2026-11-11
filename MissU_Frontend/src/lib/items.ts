import type { ItemCategory } from './activity/types';

export type PublicItem = {
  id: string;
  name: string;
  description: string;
  /** Figma 03.G/03.M "종류 · 전자기기" and the 05 registration tiles. */
  category: ItemCategory;
  /** Number of public photos (placeholders only; uploads are not connected). */
  photos: number;
  foundAt: string;
  location: string;
  storage: string;
  collectionGuide: string;
};
export type SearchFilters = { query: string; period: 'all' | '7' | '30'; place: string };
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
  const cutoff = filters.period === 'all' ? -Infinity : now - Number(filters.period) * 86_400_000;
  return items.filter((item) => {
    const haystack = `${item.name} ${item.description}`.toLocaleLowerCase();
    const time = new Date(item.foundAt).getTime();
    return (
      words.every((word) => haystack.includes(word)) &&
      item.location.toLocaleLowerCase().includes(place) &&
      time >= cutoff &&
      time <= now
    );
  });
}
// Replace this adapter when the team agrees the API contract; never silently fall back from API errors.
export const itemRepository = {
  async search(filters: SearchFilters): Promise<PublicItem[]> {
    return filterItems(mockItems, filters);
  },
  async find(id: string): Promise<PublicItem | undefined> {
    return mockItems.find((item) => item.id === id);
  },
};
export function formatFoundAt(value: string) {
  // Explicit Seoul time, independent of the test device's time zone.
  const d = new Date(new Date(value).getTime() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
