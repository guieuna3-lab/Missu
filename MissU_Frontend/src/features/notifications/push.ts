import { Platform } from 'react-native';
import { api } from '@/lib/backend';
import { clearWebPush, enableWebPush, supportsWebPush, syncWebPush } from './webPush';

type Device = { token?: string; binding?: string; enabled?: boolean };
type PushPort = { call(command: string, args: object): Promise<Device> };
const androidPush =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  /MissUPush\/1\b/.test(navigator.userAgent);
export const nativePush = androidPush || (Platform.OS === 'web' && supportsWebPush());
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
  if (!androidPush && nativePush) return enableWebPush(account, token);
  if (!nativePush)
    throw new Error(
      '아이폰은 Safari에서 미슈를 홈 화면에 추가한 뒤 아이콘으로 열어 주세요. iOS 16.4 이상에서 알림을 받을 수 있어요.',
    );
  return register(await command('pushEnable', account), token);
}
export async function syncPush(account: string, token: string) {
  if (androidPush) await register(await command('pushStatus', account), token);
  else if (nativePush) await syncWebPush(account, token);
}
export async function disconnectPush(token: string) {
  if (!nativePush) return;
  const device = androidPush ? await command('pushClear') : await clearWebPush();
  if (device?.token && device.binding)
    await api('/notifications/devices', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: device.token, binding: device.binding }),
    });
}
