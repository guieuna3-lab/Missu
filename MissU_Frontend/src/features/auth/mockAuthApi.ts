// 개발용 화면 미리보기에서 사용하는 비밀번호 변경 대체 동작입니다.
// 실제 로그인·가입·비밀번호 재설정은 authApi/passwordResetApi를 사용합니다.
// 실제 로그인 회원의 비밀번호 변경은 NewPasswordScreen에서 /me/password로 요청합니다.
export class AuthUnavailableError extends Error {}

/** 예시 계정은 저장하지 않으며 운영 빌드에서는 항상 거절합니다. */
export function changePassword(input: { password: string }): Promise<void> {
  void input;
  if (!__DEV__) return Promise.reject(new AuthUnavailableError());
  return new Promise((resolve) => setTimeout(resolve, 300));
}
