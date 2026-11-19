import { fail } from '../common/http';
import { koreaDay, sinceFound } from './institution-records';

/** 목록·건수·홈이 같은 서울 날짜 경계를 사용합니다. 끝일 전체를 포함합니다. */
export function searchRange(
  query: { period: string; from?: string; to?: string },
  at: number,
) {
  for (const day of [query.from, query.to]) {
    if (
      day &&
      (!Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day)
    )
      fail(400, 'VALIDATION_ERROR', '날짜를 확인해 주세요.');
  }
  if (query.from && query.to && query.from > query.to)
    fail(400, 'VALIDATION_ERROR', '시작일은 끝일보다 늦을 수 없어요.');
  const from = [
    sinceFound('all', at),
    query.from ?? sinceFound(query.period, at),
  ]
    .sort()
    .at(-1)!;
  const through = [koreaDay(at), query.to ?? koreaDay(at)].sort()[0];
  return {
    from,
    through,
    fromTime: new Date(from + 'T00:00:00+09:00'),
    toTime: new Date(Math.min(at, Date.parse(through + 'T23:59:59.999+09:00'))),
  };
}

export function searchPoint(value?: string) {
  if (value === undefined) return;
  const parts = value.split(',');
  const [lat, lng] = parts.map(Number);
  if (
    parts.length !== 2 ||
    parts.some((v) => !v.trim()) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    fail(400, 'VALIDATION_ERROR', '검색 기준 위치를 확인해 주세요.');
  return { lat, lng };
}
