import type { Profile } from '@/lib/preview/fixtures';

export type SignupRequest = { email: string; nickname: string; password: string };
export type AuthSession = { profile: Profile; accessToken: string };
type Challenge = { challengeId: string; expiresAt: string; retryAfter: number };

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function post<T>(path: string, body?: object, token?: string): Promise<T> {
  const base = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!base) throw new AuthApiError('미슈 서버 주소를 설정해 주세요.', 'NO_SERVER');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(base + '/auth/' + path, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        ...(body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: 'Bearer ' + token }),
      },
      body: body && JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const result = await response.json();
    if (!response.ok) {
      throw new AuthApiError(
        typeof result.error?.message === 'string'
          ? result.error.message
          : '요청을 처리하지 못했어요.',
        result.error?.code ?? 'SERVER_ERROR',
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof AuthApiError) throw error;
    throw new AuthApiError(
      '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
      'NETWORK',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function login(input: { email: string; password: string }): Promise<AuthSession> {
  const result = await post<{
    user: { email: string; nickname: string; phoneVerified: boolean };
    accessToken: string;
  }>('mobile/login', { email: input.email, password: input.password });
  return {
    profile: {
      name: result.user.nickname,
      email: result.user.email,
      phoneVerified: result.user.phoneVerified,
    },
    accessToken: result.accessToken,
  };
}

export function logout(token: string) {
  return post<void>('logout', undefined, token);
}

export function createSignupFlow(account: SignupRequest) {
  // 인증 요청과 가입 증명은 이 가입 흐름에서만 공유하고 기기에 저장하지 않습니다.
  let token = '';
  let challenge: Challenge | undefined;
  let proof = '';
  let resendAt = 0;
  let created = false;
  let uncertain = false;
  let busy = false;
  const policyVersion = process.env.EXPO_PUBLIC_POLICY_VERSION || 'v1.0';

  async function exclusive<T>(action: () => Promise<T>) {
    if (busy) throw new AuthApiError('요청을 처리하고 있어요.', 'BUSY');
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }

  return {
    email: account.email,
    requestCode: () =>
      exclusive(async () => {
        if (created) throw new AuthApiError('이미 가입했어요. 로그인해 주세요.', 'ACCOUNT_CREATED');
        const seconds = Math.ceil((resendAt - Date.now()) / 1000);
        if (seconds > 0)
          throw new AuthApiError(`${seconds}초 후에 다시 요청해 주세요.`, 'COOLDOWN');
        if (!token) token = (await post<{ accessToken: string }>('mobile/session')).accessToken;
        try {
          challenge = await post<Challenge>(
            'challenges',
            { purpose: 'SIGNUP', target: account.email },
            token,
          );
        } catch (error) {
          if (error instanceof AuthApiError && error.code === 'AUTH_REQUIRED') token = '';
          throw error;
        }
        resendAt = Date.now() + challenge.retryAfter * 1000;
        proof = '';
      }),
    complete: (code: string) =>
      exclusive(async () => {
        if (!challenge) throw new AuthApiError('인증 코드를 다시 요청해 주세요.', 'NO_CHALLENGE');
        if (created) return login(account);
        // 가입 응답을 잃은 경우, 이미 만들어진 계정인지 먼저 확인해 중복 가입을 피합니다.
        if (uncertain) {
          try {
            const session = await login(account);
            created = true;
            return session;
          } catch (error) {
            if (!(error instanceof AuthApiError) || error.code !== 'LOGIN_FAILED') throw error;
            uncertain = false;
          }
        }
        if (!proof) {
          const result = await post<{ verified: boolean; proof: string }>(
            'challenges/' + encodeURIComponent(challenge.challengeId) + '/verify',
            { code },
            token,
          );
          if (!result.verified || !result.proof)
            throw new AuthApiError('인증 코드를 다시 요청해 주세요.', 'NO_PROOF');
          proof = result.proof;
        }
        try {
          await post(
            'signup',
            {
              ...account,
              challengeId: challenge.challengeId,
              proof,
              consents: ['TERMS', 'PRIVACY'].map((kind) => ({ kind, agreed: true, policyVersion })),
            },
            token,
          );
        } catch (error) {
          uncertain = error instanceof AuthApiError && error.code === 'NETWORK';
          throw error;
        }
        created = true;
        return login(account);
      }),
  };
}
