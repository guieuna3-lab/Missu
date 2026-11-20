import type { RoutePoint } from './mapData';

export type RouteHistoryEntry = {
  id: string;
  points: RoutePoint[];
};

/** 같은 날 여러 번 시작한 기록도 각각 남기고, 저장 시각 순으로 선택할 수 있게 합니다. */
export function routeHistory(points: RoutePoint[]): RouteHistoryEntry[] {
  const groups = new Map<string, RoutePoint[]>();
  for (const point of points) {
    if (point.source === 'DEMO') continue;
    const group = groups.get(point.recordingId) ?? [];
    group.push(point);
    groups.set(point.recordingId, group);
  }
  return [...groups]
    .map(([id, items]) => ({
      id,
      points: items.sort(
        (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id),
      ),
    }))
    .sort((a, b) => Date.parse(a.points[0].recordedAt) - Date.parse(b.points[0].recordedAt));
}
