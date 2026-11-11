export type Coordinates = { lat: number; lng: number };
export const campus: Coordinates = { lat: 37.5824, lng: 127.0102 };
export type Pin = Coordinates & { id: string; title: string };
export type RoutePoint = Coordinates & {
  id: string;
  recordingId: string;
  recordedAt: string;
  source: 'DEVICE' | 'DEMO';
};
export type StreetMapProps = {
  center: Coordinates;
  pins?: Pin[];
  position?: Coordinates;
  startPoint?: Coordinates;
  selectedId?: string;
  path?: RoutePoint[];
  fitPath?: boolean;
  onMove?: (point: Coordinates) => void;
  onSelect?: (id: string) => void;
};

// 기록이 중단된 시간까지 사람이 이동한 것처럼 직선을 그리지 않습니다.
export function routeSegments(points: RoutePoint[]) {
  const result: RoutePoint[][] = [];
  for (const point of points) {
    const segment = result[result.length - 1];
    const previous = segment?.[segment.length - 1];
    if (
      !previous ||
      previous.recordingId !== point.recordingId ||
      Date.parse(point.recordedAt) - Date.parse(previous.recordedAt) > 30 * 60_000
    ) {
      result.push([point]);
    } else segment.push(point);
  }
  return result;
}

export type MapItem = {
  id: string;
  name: string;
  foundAt: string;
  category: string;
  distanceM: number;
  foundLocation: Coordinates & { label: string };
};
export async function mapApi<T>(
  path: string,
  options: { token?: string; method?: string; body?: object; signal?: AbortSignal } = {},
) {
  const base = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!base) throw new Error('미슈 서버 주소를 확인해 주세요.');
  const response = await fetch(base + path, {
    method: options.method ?? 'GET',
    credentials: 'omit',
    signal: options.signal,
    headers: {
      ...(options.body && { 'Content-Type': 'application/json' }),
      ...(options.token && { Authorization: 'Bearer ' + options.token }),
    },
    body: options.body && JSON.stringify(options.body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? '지도 정보를 가져오지 못했어요.');
  return result.data as T;
}
