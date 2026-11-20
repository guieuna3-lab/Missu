import { Platform } from 'react-native';

type RouteState = { id?: string; saved?: number; message?: string };
type NativeRoute = { call: (command: string, args: object) => Promise<RouteState> };
declare global {
  interface Window {
    missuRoute?: NativeRoute;
  }
}

// 일반 웹과 iOS에서는 기존 화면의 기록 방식을 사용합니다.
export const androidRoute =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  /MissUAndroidRoute\/[23]\b/.test(navigator.userAgent);
let account: string | null = null;
export function reconcileRouteAccount(token: string | null, owner: string | null = null): void {
  account = owner;
  // 이전 APK에는 없는 명령입니다. 새 설치본만 같은 계정의 갱신된 토큰을 전달합니다.
  if (androidRoute && /MissUAndroidRoute\/3\b/.test(navigator.userAgent))
    void routeCommand('reconcile', { token, account: owner }).catch(() => undefined);
}
export async function routeCommand(command: string, args: object) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (window.missuRoute) return window.missuRoute.call(command, { account, ...args });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('휴대폰의 경로 기록 기능에 연결하지 못했어요. 미슈를 다시 열어 주세요.');
}
