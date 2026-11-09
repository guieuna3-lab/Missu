import { mockItems } from '@/lib/items';

export type MapPoint = { x: number; y: number };
export const mapOrigin: MapPoint = { x: 220, y: 364 };
export const zeroOffset: MapPoint = { x: 0, y: 0 };

export type MapCoordinate = { latitude: number; longitude: number };
const campusCenter = { latitude: 37.582552553035875, longitude: 127.01021759756136 };
// Approximate projection of the example campus artwork onto the native map.
const latitudePerPoint = 0.000027;
const longitudePerPoint = 0.000034;

export function coordinateForPoint(point: MapPoint): MapCoordinate {
  return {
    latitude: campusCenter.latitude + (mapOrigin.y - point.y) * latitudePerPoint,
    longitude: campusCenter.longitude + (point.x - mapOrigin.x) * longitudePerPoint,
  };
}

export function pointForCoordinate({ latitude, longitude }: MapCoordinate): MapPoint {
  return {
    x: mapOrigin.x + (longitude - campusCenter.longitude) / longitudePerPoint,
    y: mapOrigin.y - (latitude - campusCenter.latitude) / latitudePerPoint,
  };
}

function distanceInMeters(from: MapCoordinate, to: MapCoordinate) {
  const radians = Math.PI / 180;
  const latDelta = (to.latitude - from.latitude) * radians;
  const lonDelta = (to.longitude - from.longitude) * radians;
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(from.latitude * radians) *
      Math.cos(to.latitude * radians) *
      Math.sin(lonDelta / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(a, 1)));
}

export const categories = [
  { value: 'ALL', label: '전체' },
  { value: 'ELECTRONICS', label: '전자기기' },
  { value: 'WALLET_BAG', label: '지갑/가방' },
] as const;
export const periods = [
  { value: 'ALL', label: '전체 기간' },
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
] as const;
export const radii = [
  { value: 500, label: '500m' },
  { value: 1000, label: '1km' },
  { value: 3000, label: '3km' },
] as const;

export type NearbyFilters = {
  category: (typeof categories)[number]['value'];
  registeredDays: (typeof periods)[number]['value'];
  radiusM: (typeof radii)[number]['value'];
};
export const defaultFilters: NearbyFilters = {
  category: 'ALL',
  registeredDays: 'ALL',
  radiusM: 1000,
};

export const places = [
  { name: '삼선동', point: mapOrigin },
  { name: '중앙도서관', point: { x: 168, y: 230 } },
  { name: '학생식당', point: { x: 43, y: 352 } },
  { name: '공학관', point: { x: 316, y: 323 } },
  { name: '행정실', point: { x: 168, y: 442 } },
  { name: '솔숲공원', point: { x: 330, y: 522 } },
  {
    name: '한성대입구역',
    point: { x: 233, y: 669 },
    coordinate: { latitude: 37.58842, longitude: 127.00618 },
  },
  { name: '삼선교로', point: { x: 43, y: 131 } },
  { name: '버스 정류장', point: { x: 54, y: 236 } },
  { name: '한성대학교', point: mapOrigin },
] as const;

// Local illustration coordinates and approximate distances for the Figma campus preview.
const markers = [
  { id: 'buds', icon: 'buds', category: 'ELECTRONICS', x: 211, y: 245, distance: 150 },
  { id: 'key', icon: 'key', category: 'OTHER', x: 98, y: 333, distance: 280 },
  { id: 'wallet', icon: 'wallet', category: 'WALLET_BAG', x: 326, y: 306, distance: 430 },
  { id: 'student-id', icon: 'id', category: 'OTHER', x: 190, y: 430, distance: 520 },
  { id: 'backpack', icon: 'bag', category: 'WALLET_BAG', x: 54, y: 236, distance: 700 },
] as const;

const nearbyItems = markers.flatMap((marker) => {
  const item = mockItems.find(({ id }) => id === marker.id);
  return item ? [{ ...item, marker }] : [];
});

export function searchNearby(
  filters: NearbyFilters,
  query: string,
  offset: MapPoint,
  now = Date.now(),
  center?: MapCoordinate,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const cutoff =
    filters.registeredDays === 'ALL'
      ? -Infinity
      : now - Number(filters.registeredDays) * 86_400_000;
  return nearbyItems
    .filter(({ marker, name, description, location, foundAt }) => {
      const date = new Date(foundAt).getTime();
      const text = `${name} ${description} ${location}`.toLocaleLowerCase();
      return (
        (filters.category === 'ALL' || filters.category === marker.category) &&
        date >= cutoff &&
        date <= now &&
        terms.every((term) => text.includes(term))
      );
    })
    .map((item) => {
      const { x, y, distance } = item.marker;
      if (center) {
        return {
          ...item,
          distanceM: Math.round(distanceInMeters(center, coordinateForPoint({ x, y }))),
        };
      }
      const dx = x - mapOrigin.x;
      const dy = y - mapOrigin.y;
      const scale = distance / Math.hypot(dx, dy);
      const distanceM = Math.round(
        Math.hypot(dx * scale + offset.x * 3, dy * scale + offset.y * 3),
      );
      return { ...item, distanceM };
    })
    .filter(({ distanceM }) => distanceM <= filters.radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

export type NearbyItem = ReturnType<typeof searchNearby>[number];
