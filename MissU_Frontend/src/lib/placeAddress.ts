import { api } from './backend.ts';

export const isCurrentLocationLabel = (label: string) => /^현재\s*위치$/.test(label.trim());

export function devicePlaceLabel(address: string | undefined, detail: string) {
  const typed = detail.trim();
  const note = isCurrentLocationLabel(typed) ? '' : typed;
  if (!address) return note;
  if (!note) return address;
  return note.startsWith(address) ? note : address + ' · ' + note;
}

export async function lookupPlaceAddress(
  point: { lat: number; lng: number },
  token?: string | null,
) {
  // 로그인 전 장소 선택 화면에서도 기존 모바일 익명 세션의 요청 검사를 그대로 사용합니다.
  const bearer =
    token ??
    (await api<{ data: { accessToken: string } }>('/auth/mobile/session', { method: 'POST' })).data
      .accessToken;
  const { data } = await api<{ data: { address: string | null } }>('/places/reverse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer },
    body: JSON.stringify({ lat: point.lat, lng: point.lng }),
  });
  return data.address;
}
