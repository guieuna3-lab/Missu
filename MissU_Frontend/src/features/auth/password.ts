// New-password rule shared by sign-up, password reset and password change.
// Keep in sync with missu-backend/src/common/password.ts, which enforces the same rule.
// Login keeps checking length only so accounts created before this rule can still sign in.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const PASSWORD_HINT = '12자 이상, 영문·숫자·특수문자 포함';

// Allowed characters: keyboard letters, digits and specials (ASCII 0x21–0x7E). No Korean, spaces or emoji.
const allowedPattern = /^[!-~]*$/;
const letterPattern = /[A-Za-z]/;
const digitPattern = /\d/;
const specialPattern = /[!-/:-@[-`{-~]/;

// Returns the first problem as a user-facing message, or undefined when the password is valid.
export function passwordProblem(value: string): string | undefined {
  if (!allowedPattern.test(value)) return '한글·공백 없이 영문, 숫자, 특수문자만 입력해 주세요.';
  if (value.length < MIN_PASSWORD_LENGTH)
    return `비밀번호를 ${MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.`;
  if (value.length > MAX_PASSWORD_LENGTH)
    return `비밀번호는 ${MAX_PASSWORD_LENGTH}자까지 입력할 수 있어요.`;
  const missing = [
    letterPattern.test(value) ? null : '영문',
    digitPattern.test(value) ? null : '숫자',
    specialPattern.test(value) ? null : '특수문자',
  ].filter((part): part is string => part !== null);
  if (missing.length > 0) return `${missing.join('·')}를 1개 이상 포함해 주세요.`;
  return undefined;
}

export function isValidPassword(value: string) {
  return passwordProblem(value) === undefined;
}
