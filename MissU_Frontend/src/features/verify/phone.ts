// Korean mobile number helpers for the 07 screens. Figma shows "010-0000-0000" input and
// "010-****-0000" in the code screen; the exact format rule is provisional.
export function normalizePhone(text: string) {
  return text.replace(/\D/g, '');
}

export function isPhoneNumber(text: string) {
  return /^01[016789]\d{7,8}$/.test(normalizePhone(text));
}

/** "01012345678" → "010-1234-5678" */
export function formatPhone(text: string) {
  const digits = normalizePhone(text);
  if (digits.length < 10) return text;
  return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
}

/** "01012345678" → "010-****-5678" */
export function maskPhone(text: string) {
  const digits = normalizePhone(text);
  if (digits.length < 10) return text;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}
