// Figma examples only. These are not API responses or authenticated user data.
export const previewProfile = { name: '홍길동', email: 'missu@example.com' };
export type Profile = typeof previewProfile;

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

export const previewActivity = {
  lost: '검정 에어팟 프로 케이스 · 신고됨',
  returned: '갤럭시 버즈2 (검정) · 진행 상태 보기',
  found: '갤럭시 버즈2 (검정) · 받은 요청 1건',
  nearby: '반경 1km · 5건 보관 중',
  itemTitle: '갤럭시 버즈2 (검정)',
  storage: '중앙도서관 1층 안내데스크\n습득일: 2026.10.06 · 사진 1장',
  request: '홍길동 · 확인 대기\n물품 특징과 분실 시점·장소를 확인해 주세요.',
};
