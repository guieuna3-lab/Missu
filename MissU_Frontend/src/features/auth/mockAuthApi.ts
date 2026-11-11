// Development-only mock of the auth API. The server contract (URLs, fields, tokens) is not agreed
// yet, so nothing here sends a request or an email, stores input, or checks credentials.
// Release builds reject every call instead of pretending to succeed.
// Replace this module with the real API once the contract exists.
import { previewProfile, type Profile } from '@/lib/preview/fixtures';

export class AuthUnavailableError extends Error {}

export type SignupRequest = { email: string; nickname: string; password: string };

// A short wait keeps the submitting state visible, like a network request.
const MOCK_DELAY_MS = 300;

function respond<T>(value: T): Promise<T> {
  if (!__DEV__) return Promise.reject(new AuthUnavailableError());
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

/** Accepts any well-formed input. The mock has no accounts, so the name is the Figma example. */
export function login(input: { email: string; password: string }): Promise<Profile> {
  return respond({ name: previewProfile.name, email: input.email });
}

export function requestSignupCode(request: SignupRequest): Promise<void> {
  return respond(undefined);
}

export function resendSignupCode(email: string): Promise<void> {
  return respond(undefined);
}

/** Accepts any 6-digit code. */
export function confirmSignup(input: {
  email: string;
  nickname: string;
  code: string;
}): Promise<Profile> {
  return respond({ name: input.nickname, email: input.email });
}

export function requestPasswordReset(email: string): Promise<void> {
  return respond(undefined);
}

/** Figma 02-A.05 from 계정 관리. The mock stores nothing. */
export function changePassword(input: { password: string }): Promise<void> {
  void input;
  return respond(undefined);
}
