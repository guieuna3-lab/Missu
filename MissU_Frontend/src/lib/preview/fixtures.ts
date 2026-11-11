// Figma examples only. These are not API responses or authenticated user data.
export type Profile = {
  name: string;
  email: string;
  /** Verified mobile number (digits only) once the 07 flow completed. Never shown to others. */
  phoneVerified?: boolean;
  phone?: string;
};
export const previewProfile: Profile = { name: '홍길동', email: 'missu@example.com' };

export const previewItems = [
  {
    id: 'buds',
    icon: 'buds',
    title: '갤럭시 버즈2 (검정)',
    location: '중앙도서관 3층 · 150m',
  },
  { id: 'key', icon: 'key', title: '자동차 키 (현대)', location: '학생식당 앞 · 280m' },
  { id: 'wallet', icon: 'wallet', title: '검정 반지갑', location: '공학관 1층 · 430m' },
] as const;

// The member's reports, requests and registered items live in lib/activity (ActivityProvider).
export const previewActivity = {
  nearby: '반경 1km · 5건 보관 중',
};
