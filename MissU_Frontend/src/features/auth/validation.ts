import { AuthUnavailableError } from './mockAuthApi';

// Figma states the rules (email, 8+ character password, 6-digit code) but not the error texts.
// The messages below are provisional until the design defines them.
export const MIN_PASSWORD_LENGTH = 8;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string) {
  return emailPattern.test(value.trim());
}

export function isVerificationCode(value: string) {
  return /^\d{6}$/.test(value);
}

export function requestErrorMessage(error: unknown) {
  return error instanceof AuthUnavailableError
    ? '서버 연결 전이라 아직 이용할 수 없어요.'
    : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
