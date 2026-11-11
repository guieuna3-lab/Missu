import { randomUUID } from 'expo-crypto';
import { api, ApiError } from '@/lib/backend';
import type { LostReport } from './types';
import type { LostReportInput } from './transitions';
type Row = {
  id: string;
  name: string;
  category: LostReport['category'];
  features: string | null;
  createdAt: string;
  placeName: string;
  lostTime: { start: string; end: string };
  lostLocation: { label: string; lat: number; lng: number };
};
const fromRow = (r: Row): LostReport => ({
  id: r.id,
  name: r.name,
  category: r.category,
  feature: r.features ?? '',
  createdAt: r.createdAt,
  lostFrom: r.lostTime.start,
  lostTo: r.lostTime.end,
  place: {
    name: r.placeName,
    detail: r.lostLocation.label,
    lat: r.lostLocation.lat,
    lng: r.lostLocation.lng,
  },
});
export function lostReportClient(token: string) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const attempts = new Map<string, string>();
  async function list() {
    let cursor: string | null = null;
    const rows: LostReport[] = [];
    do {
      const page: { data: Row[]; meta: { nextCursor: string | null } } = await api(
        '/lost-reports' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        { headers },
      );
      rows.push(...page.data.map(fromRow));
      cursor = page.meta.nextCursor;
    } while (cursor);
    return rows;
  }
  async function save(input: LostReportInput, id?: string) {
    const { place } = input;
    if (place.lat == null || place.lng == null)
      throw new ApiError(400, '분실 장소를 다시 선택해 주세요.');
    const body = JSON.stringify({
      name: input.name,
      category: input.category,
      features: input.feature,
      placeName: place.name,
      lostLocation: { label: place.detail, lat: place.lat, lng: place.lng },
      lostTime: {
        start: input.lostFrom,
        end: input.lostTo,
        precision: Date.parse(input.lostFrom) === Date.parse(input.lostTo) ? 'EXACT' : 'APPROX',
      },
    });
    if (id)
      return fromRow(
        (await api<{ data: Row }>('/lost-reports/' + id, { method: 'PUT', headers, body })).data,
      );
    const key = attempts.get(body) ?? randomUUID();
    attempts.set(body, key);
    const result = await api<{ data: { id: string } }>('/lost-reports', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body,
    });
    const report = fromRow(
      (await api<{ data: Row }>('/lost-reports/' + result.data.id, { headers })).data,
    );
    attempts.delete(body);
    return report;
  }
  return {
    list,
    save,
    remove: (id: string) => api<void>('/lost-reports/' + id, { method: 'DELETE', headers }),
  };
}
