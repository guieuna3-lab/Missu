// Shapes of the member's activity: lost reports (04), registered found items (05) and
// ownership requests seen from both sides (08 requester, 08-B holder).
// These are UI types for the mock layer; the server contract is not agreed yet.

export type ItemCategory = 'ELECTRONICS' | 'WALLET' | 'BAG' | 'KEY' | 'ID' | 'OTHER';

// Figma 04.02 / 05.01 물품 종류 tiles. The 10 nearby filter uses a coarser list
// (ELECTRONICS / WALLET_BAG / OTHER); aligning the two is an open item (figma-review D7).
export const categories: { value: ItemCategory; label: string }[] = [
  { value: 'ELECTRONICS', label: '전자기기' },
  { value: 'WALLET', label: '지갑' },
  { value: 'BAG', label: '가방' },
  { value: 'KEY', label: '열쇠' },
  { value: 'ID', label: '신분증' },
  { value: 'OTHER', label: '기타' },
];

export function categoryLabel(category: ItemCategory) {
  return categories.find((c) => c.value === category)?.label ?? '기타';
}

/** A place picked on the 09 screens: the place name plus the free-text detail line. */
export type Place = { name: string; detail: string };

export type LostReport = {
  id: string;
  category: ItemCategory;
  name: string;
  feature: string;
  /** ISO. The design stores the lost time as a range; a single moment has lostTo === lostFrom. */
  lostFrom: string;
  lostTo: string;
  place: Place;
  createdAt: string;
};

export type FoundItem = {
  id: string;
  category: ItemCategory;
  name: string;
  /** ISO */
  foundAt: string;
  place: Place;
  /** Number of attached photos. The mock keeps no image data (see PhotoAttachment). */
  photos: number;
  storage: string;
  pickupGuide: string;
  /** Shown only to the holder and compared on 08-B.01. Never public. */
  privateFeature: string;
  createdAt: string;
};

export type RequestStatus =
  'pending' | 'approved' | 'scheduled' | 'handed' | 'completed' | 'rejected';

export type Party = 'requester' | 'holder';

export type Appointment = { place: string; date: string; time: string };
export type AppointmentProposal = Appointment & { by: Party };

export type ChatMessage = { id: string; by: Party; text: string; sentAt: string };

export type ReportReason = 'PREPAYMENT' | 'EXTERNAL_LINK' | 'IMPERSONATION' | 'OTHER';
export const reportReasons: { value: ReportReason; label: string }[] = [
  { value: 'PREPAYMENT', label: '선입금 요구' },
  { value: 'EXTERNAL_LINK', label: '외부 링크 유도' },
  { value: 'IMPERSONATION', label: '다른 사람 사칭' },
  { value: 'OTHER', label: '기타' },
];

export type SuspiciousReport = {
  by: Party;
  reason: ReportReason;
  description: string;
  photos: number;
  createdAt: string;
};

export type OwnershipRequest = {
  id: string;
  itemId: string;
  itemName: string;
  /** Where the item is kept, as shown on 08.03 ("중앙도서관 보관"). */
  storageName: string;
  requesterName: string;
  feature: string;
  lostFrom: string;
  lostTo: string;
  lostPlace: string;
  status: RequestStatus;
  createdAt: string;
  messages: ChatMessage[];
  /** The latest proposal waiting for the other side's 확인. */
  proposal?: AppointmentProposal;
  /** Set when a proposal was confirmed (status becomes 'scheduled'). */
  appointment?: Appointment;
  handedAt?: string;
  completedAt?: string;
  reports: SuspiciousReport[];
};

export type ActivityState = {
  lostReports: LostReport[];
  foundItems: FoundItem[];
  requests: OwnershipRequest[];
};

/** 01.07 card state, derived from the requests on the item. */
export type FoundItemStatus = 'storing' | 'returning' | 'handed' | 'returned';

export const foundItemStatusLabel: Record<FoundItemStatus, string> = {
  storing: '보관 중',
  returning: '반환 진행 중',
  handed: '전달 완료',
  returned: '반환 완료',
};
