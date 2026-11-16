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

/** Formats as the user types: "0101234" → "010-1234", "01012345678" → "010-1234-5678". */
export function formatPhoneInput(text: string) {
  const digits = normalizePhone(text).slice(0, 11);
  if (digits.length <= 3) return digits;
  // 10-digit numbers other than 010 (e.g. 011-234-5678) use a 3-digit middle part.
  const middle = digits.length === 10 && !digits.startsWith('010') ? 3 : 4;
  if (digits.length <= 3 + middle) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 3 + middle)}-${digits.slice(3 + middle)}`;
}
