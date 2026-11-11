import type { ActivityState } from './types';

// Figma examples only. The preview member (홍길동) is both the holder of the registered
// item and the requester of the pending request on it, so one account can walk through
// the 08 (requester) and 08-B (holder) flows against the same request.
export const sampleActivity: ActivityState = {
  lostReports: [
    {
      id: 'lost-1',
      category: 'ELECTRONICS',
      name: '검정 에어팟 프로 케이스',
      feature: '앞면에 흰색 고양이 스티커',
      lostFrom: '2026-10-06T14:00:00+09:00',
      lostTo: '2026-10-06T18:00:00+09:00',
      place: { name: '중앙도서관', detail: '중앙도서관 3층 열람실' },
      createdAt: '2026-10-06T19:00:00+09:00',
    },
  ],
  foundItems: [
    {
      id: 'buds',
      category: 'ELECTRONICS',
      name: '갤럭시 버즈2 (검정)',
      foundAt: '2026-10-06T14:20:00+09:00',
      place: { name: '중앙도서관', detail: '중앙도서관 3층 열람실' },
      photos: 1,
      storage: '중앙도서관 1층 안내데스크',
      pickupGuide: '평일 09:00–18:00, 방문 전 확인',
      privateFeature: '케이스 안쪽의 파란색 별 스티커',
      createdAt: '2026-10-06T15:00:00+09:00',
    },
  ],
  requests: [
    {
      id: 'request-1',
      itemId: 'buds',
      itemName: '갤럭시 버즈2 (검정)',
      storageName: '중앙도서관',
      requesterName: '홍길동',
      feature: '케이스 안쪽에 파란 별 스티커가 있어요.',
      lostFrom: '2026-10-06T14:00:00+09:00',
      lostTo: '2026-10-06T18:00:00+09:00',
      lostPlace: '중앙도서관 열람실',
      status: 'pending',
      createdAt: '2026-10-06T16:00:00+09:00',
      messages: [],
      reports: [],
    },
  ],
};

export const emptyActivity: ActivityState = { lostReports: [], foundItems: [], requests: [] };
