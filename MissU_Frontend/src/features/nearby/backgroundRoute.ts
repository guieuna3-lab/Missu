// 안드로이드 설치 앱은 기존 웹 연결을 사용하고 Safari와 일반 브라우저는 화면 안에서 기록합니다.
export { androidRoute as backgroundRoute, routeCommand } from './androidRoute';
export const stopHint = '알림에서 언제든 중지할 수 있어요.';
export function reconcileRouteAccount(token: string | null): void {
  // 안드로이드 서비스의 세션 수명은 네이티브 런처가 관리합니다.
  void token;
}
