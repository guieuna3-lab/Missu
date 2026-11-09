// Expo에 공개하는 값은 서버 주소뿐입니다. 로그인 토큰은 앱 메모리에만 보관합니다.
export const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!apiBase) throw new Error('시연 서버 주소를 설정해 주세요.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(apiBase + path, {
      ...options,
      credentials: 'omit',
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, body.error?.message ?? '요청에 실패했어요.');
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('노트북의 미슈 서버에 연결할 수 없어요. 같은 Wi-Fi인지 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
}

export function loginMobile(email: string, password: string) {
  return api<{ data: { user: { nickname: string; email: string }; accessToken: string } }>(
    '/auth/mobile/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
}
