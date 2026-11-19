import { Platform } from 'react-native';
import { api } from '@/lib/backend';

type Device = { token?: string; binding?: string; enabled?: boolean };
type PushPort = { call(command: string, args: object): Promise<Device> };
export const nativePush =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  /MissUPush\/1\b/.test(navigator.userAgent);
async function command(name: string, account?: string) {
  for (let n = 0; n < 40; n++) {
    const port = (window as unknown as { missuRoute?: PushPort }).missuRoute;
    if (port) return port.call(name, { account });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('알림 기능에 연결하지 못했어요. 미슈를 다시 열어 주세요.');
}
async function register(device: Device, accessToken: string) {
  if (!device.token || !device.binding) return false;
  await api('/notifications/devices', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: device.token, binding: device.binding }),
  });
  return true;
}
export async function enablePush(account: string, token: string) {
  if (!nativePush)
    throw new Error(
      '휴대폰 푸시는 새 안드로이드 미슈 APK에서 켤 수 있어요. 이 화면에서는 앱 안의 알림을 확인할 수 있어요.',
    );
  return register(await command('pushEnable', account), token);
}
export async function syncPush(account: string, token: string) {
  if (nativePush) await register(await command('pushStatus', account), token);
}
export async function disconnectPush(token: string) {
  if (!nativePush) return;
  const device = await command('pushClear');
  if (device.token && device.binding)
    await api('/notifications/devices', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: device.token, binding: device.binding }),
    });
}
