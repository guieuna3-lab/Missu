import { respond } from '@/lib/mockRequest';

// Development-only mock of the SMS verification API (Figma 07). No message is sent and the
// number is not stored anywhere. Any 6-digit code passes except 000000, which stands in for
// a wrong or expired code so that 07.04 can be reached. Replace with the real API later.
export class InvalidCodeError extends Error {}

export const CODE_VALID_SECONDS = 180;
export const MAX_RESENDS = 2;

export function requestPhoneCode(phone: string): Promise<void> {
  void phone;
  return respond(undefined);
}

export async function confirmPhoneCode(input: { phone: string; code: string }): Promise<void> {
  await respond(undefined);
  if (input.code === '000000') throw new InvalidCodeError();
}
