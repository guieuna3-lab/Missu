import type { ActivityState, OwnershipRequest, RequestStatus } from '@/lib/activity/types';

// How the single-account mock splits the request list for the 01.05 cards and 01.09 tabs:
// requests the member sent (requester side) and requests on the member's own items (holder
// side). In the Figma example both are the same request.
export function sentRequests(state: Pick<ActivityState, 'requests'>, memberName: string) {
  return state.requests.filter((r) => r.requesterName === memberName);
}

export function receivedRequests(state: Pick<ActivityState, 'requests' | 'foundItems'>) {
  return state.requests.filter((r) => state.foundItems.some((item) => item.id === r.itemId));
}

/** 01.05 / 01.09 wording for the requester side of a request. */
export const requestStatusLabel: Record<RequestStatus, string> = {
  pending: '확인 대기',
  approved: '승인 · 반환 대화',
  scheduled: '일정 확정',
  handed: '전달 완료 · 수령 확인',
  completed: '반환 완료',
  rejected: '승인 거절',
};

/** 01.07 wording for the holder side of a request. */
export const receivedStatusLabel: Record<RequestStatus, string> = {
  pending: '확인 대기',
  approved: '주인 확인 승인',
  scheduled: '주인 확인 승인',
  handed: '전달 완료',
  completed: '수령 확인 완료',
  rejected: '요청 거절',
};

/** The request a 01.07 card talks about: the one in progress, else the newest. */
export function primaryRequest(requests: OwnershipRequest[]) {
  return requests.find((r) => r.status !== 'rejected') ?? requests[0];
}
