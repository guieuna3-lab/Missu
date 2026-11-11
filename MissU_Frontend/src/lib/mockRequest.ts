import { ApiError } from './backend';
import { ActivityError } from './activity/transitions';

// Development-only stand-in for server calls made by the report, verification and return
// screens (the auth flow has its own copy in features/auth/mockAuthApi.ts). Nothing is sent
// anywhere. Release builds reject every call instead of pretending to succeed, and the
// screens show the message below. Replace with the real API once the contract exists.
export class RequestUnavailableError extends Error {}

// A short wait keeps the submitting state visible, like a network request.
const MOCK_DELAY_MS = 300;

export function respond<T>(value: T): Promise<T> {
  if (!__DEV__) return Promise.reject(new RequestUnavailableError());
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

export function requestErrorMessage(error: unknown) {
  if (error instanceof RequestUnavailableError) return '서버 연결 전이라 아직 이용할 수 없어요.';
  if (error instanceof ApiError || error instanceof ActivityError) return error.message;
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
