import { AuthApiError, post } from './authApi';
// 인증 증명은 이 브라우저의 재설정 흐름에서만 사용하며 주소와 저장소에는 남기지 않습니다.
type ResetFlow = { email: string; token: string; challengeId: string; proof?: string };
let current: ResetFlow | undefined;
export const resetEmail = () => current?.email;
export const resetVerified = () => !!current?.proof;
export async function requestPasswordReset(address: string) {
  const email = address.trim().toLowerCase();
  const previous = current;
  const token =
    previous?.email === email
      ? previous.token
      : (await post<{ accessToken: string }>('mobile/session')).accessToken;
  try {
    const challenge = await post<{ challengeId: string }>(
      'challenges',
      { purpose: 'RESET', target: email },
      token,
    );
    current = { email, token, challengeId: challenge.challengeId };
  } catch (e) {
    if (e instanceof AuthApiError && e.code === 'AUTH_REQUIRED' && current === previous)
      current = undefined;
    throw e;
  }
}
export async function verifyResetCode(code: string) {
  const flow = current;
  if (!flow) throw new AuthApiError('인증 코드를 다시 요청해 주세요.', 'NO_CHALLENGE');
  if (flow.proof) return;
  const result = await post<{ proof: string }>(
    'challenges/' + flow.challengeId + '/verify',
    { code },
    flow.token,
  );
  if (flow !== current) throw new AuthApiError('새로 받은 코드를 확인해 주세요.', 'CHANGED');
  flow.proof = result.proof;
}
export async function finishReset(newPassword: string) {
  const flow = current;
  if (!flow?.proof) throw new AuthApiError('이메일 인증을 다시 진행해 주세요.', 'NO_PROOF');
  await post(
    'password-reset',
    { newPassword, proof: flow.proof, challengeId: flow.challengeId },
    flow.token,
  );
  if (flow === current) current = undefined;
}
