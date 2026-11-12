import type { Pin } from '../nearby/mapData';

export type PlaceOption = {
  id: string;
  name: string;
  description: string;
  address?: string;
  lat?: number;
  lng?: number;
  icon: 'book' | 'bus';
};

// 검색·이전 신고·기기 위치에서 받은 좌표만 지도에 표시합니다.
export function placePins(places: PlaceOption[]): Pin[] {
  return places.flatMap(({ id, name, lat, lng }) => {
    if (
      lat == null ||
      lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      return [];
    return [{ id, title: name, lat, lng }];
  });
}
