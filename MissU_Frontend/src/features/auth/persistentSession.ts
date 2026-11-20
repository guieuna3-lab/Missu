import * as SecureStore from 'expo-secure-store';
import { post, type AuthSession, AuthApiError } from './authApi';
const key = 'missu.login.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>) {
  const pending = queue.then(run, run);
  queue = pending.catch(() => undefined);
  return pending;
}
export function saveSession(session: AuthSession) {
  return serial(async () => {
    const previous = await SecureStore.getItemAsync(key, options);
    const grant = await post<{ token: string }>('mobile/remember', undefined, session.accessToken);
    await SecureStore.setItemAsync(key, grant.token, options);
    if (previous) await post('mobile/forget', { token: previous }).catch(() => undefined);
  });
}
export function clearSavedSession() {
  return serial(async () => {
    const token = await SecureStore.getItemAsync(key, options);
    await SecureStore.deleteItemAsync(key, options);
    if (token) await post('mobile/forget', { token });
  });
}
export function restoreSession(): Promise<AuthSession | null> {
  return serial(async () => {
    const token = await SecureStore.getItemAsync(key, options);
    if (!token) return null;
    try {
      const result = await post<{
        accessToken: string;
        user: { nickname: string; email: string; phoneVerified: boolean };
      }>('mobile/restore', { token });
      return {
        accessToken: result.accessToken,
        profile: {
          name: result.user.nickname,
          email: result.user.email,
          phoneVerified: result.user.phoneVerified,
        },
      };
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'AUTH_REQUIRED') {
        await SecureStore.deleteItemAsync(key, options);
        return null;
      }
      throw e;
    }
  });
}
