import { api, ApiError } from '@/lib/backend';
export class InvalidCodeError extends Error {}
export const CODE_VALID_SECONDS = 180;
export const MAX_RESENDS = 2;
// 인증 요청 ID는 메모리에만 보관하고 서버에서 해당 로그인 세션을 다시 검증합니다.
let pending: { id: string; phone: string } | undefined;
export function pendingPhone() {
  return pending?.phone ?? '';
}
export async function requestPhoneCode(phone: string, token: string | null) {
  if (!token) throw new ApiError(401, '로그인이 필요합니다.');
  const { data } = await api<{ data: { challengeId: string } }>('/auth/challenges', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'PHONE',
      target: phone,
      consent: {
        kind: 'PHONE',
        agreed: true,
        policyVersion: process.env.EXPO_PUBLIC_POLICY_VERSION,
      },
    }),
  });
  pending = { id: data.challengeId, phone };
}
export async function confirmPhoneCode(
  input: { phone: string; code: string },
  token: string | null,
) {
  if (!token || pending?.phone !== input.phone) throw new InvalidCodeError();
  const result = await api<{ data: { verified: boolean } }>(
    '/auth/challenges/' + pending.id + '/verify',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input.code }),
    },
  );
  if (!result.data.verified) throw new InvalidCodeError();
  pending = undefined;
}
