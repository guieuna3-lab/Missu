import type { AuthSession } from './authApi';
type Reply = {
  user: { email: string; nickname: string; phoneVerified: boolean };
  accessToken: string;
};
const key = 'missu.login.v1';
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
function flag(value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
    return value;
  } catch {
    return null;
  }
}
function serial<T>(run: () => Promise<T>) {
  const pending = queue.then(run, run);
  queue = pending.catch(() => undefined);
  return pending;
}
async function call(path: string, token?: string): Promise<Reply | null> {
  const response = await fetch('/session-api/' + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Missu-Session': '1', ...(token && { Authorization: 'Bearer ' + token }) },
    signal: AbortSignal.timeout(75000),
  });
  if (response.status === 401 && path === 'restore') return null;
  if (!response.ok) throw Error('로그인 유지 설정에 연결하지 못했어요. 다시 시도해 주세요.');
  return response.status === 204 ? null : ((await response.json()).data as Reply);
}
/** 기기 저장소에는 로그인 여부만 둡니다. 자격 정보는 HttpOnly 쿠키라 JS에서 읽을 수 없습니다. */
export function saveSession(session: AuthSession) {
  const run = ++generation;
  flag('blocked');
  return serial(async () => {
    await call('save', session.accessToken);
    if (run === generation && flag('active') !== 'active')
      throw Error('이 브라우저에서는 로그인 유지 저장을 허용하지 않아요.');
  });
}
export function clearSavedSession() {
  generation++;
  // 오프라인 로그아웃 직후 창을 닫아도 다음 시작에서 이전 계정을 복원하지 않습니다.
  flag('blocked');
  return serial(async () => {
    await call('forget');
    flag('none');
  });
}
export function restoreSession(): Promise<AuthSession | null> {
  return serial(async () => {
    if (typeof window === 'undefined') return null;
    if (flag() === 'blocked') {
      await call('forget');
      flag('none');
      return null;
    }
    if (flag() !== 'active') return null;
    const result = await call('restore');
    if (!result) {
      flag('none');
      return null;
    }
    return {
      accessToken: result.accessToken,
      profile: {
        name: result.user.nickname,
        email: result.user.email,
        phoneVerified: result.user.phoneVerified,
      },
    };
  });
}
