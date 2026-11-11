import type {
  ActivityState,
  Appointment,
  FoundItem,
  FoundItemStatus,
  LostReport,
  OwnershipRequest,
  Party,
  SuspiciousReport,
} from './types';

// Pure state transitions for the mock activity store. Every function returns a new state
// and throws ActivityError when the design does not allow the step from the current status.
// The server will own these rules once the API exists; the UI must not assume success.

export class ActivityError extends Error {}

type Clock = { id: string; now: string };

function requireRequest(state: ActivityState, id: string) {
  const request = state.requests.find((r) => r.id === id);
  if (!request) throw new ActivityError('요청을 찾을 수 없어요.');
  return request;
}

function replaceRequest(state: ActivityState, next: OwnershipRequest): ActivityState {
  return { ...state, requests: state.requests.map((r) => (r.id === next.id ? next : r)) };
}

function requireStatus(request: OwnershipRequest, allowed: OwnershipRequest['status'][]) {
  if (!allowed.includes(request.status))
    throw new ActivityError('지금 상태에서는 처리할 수 없는 요청이에요.');
}

// 04 분실 신고
export type LostReportInput = Omit<LostReport, 'id' | 'createdAt'>;

export function addLostReport(state: ActivityState, input: LostReportInput, clock: Clock) {
  const report: LostReport = { ...input, id: clock.id, createdAt: clock.now };
  return { state: { ...state, lostReports: [report, ...state.lostReports] }, report };
}

export function updateLostReport(
  state: ActivityState,
  id: string,
  patch: Partial<LostReportInput>,
) {
  if (!state.lostReports.some((r) => r.id === id))
    throw new ActivityError('신고를 찾을 수 없어요.');
  return {
    ...state,
    lostReports: state.lostReports.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
}

export function deleteLostReport(state: ActivityState, id: string) {
  if (!state.lostReports.some((r) => r.id === id))
    throw new ActivityError('신고를 찾을 수 없어요.');
  return { ...state, lostReports: state.lostReports.filter((r) => r.id !== id) };
}

// 05 습득물 등록
export type FoundItemInput = Omit<FoundItem, 'id' | 'createdAt'>;

export function addFoundItem(state: ActivityState, input: FoundItemInput, clock: Clock) {
  const item: FoundItem = { ...input, id: clock.id, createdAt: clock.now };
  return { state: { ...state, foundItems: [item, ...state.foundItems] }, item };
}

export function updateFoundItem(state: ActivityState, id: string, patch: Partial<FoundItemInput>) {
  if (!state.foundItems.some((i) => i.id === id)) throw new ActivityError('물품을 찾을 수 없어요.');
  const foundItems = state.foundItems.map((i) => (i.id === id ? { ...i, ...patch } : i));
  // Requests show the item name, so keep them in sync.
  const requests = patch.name
    ? state.requests.map((r) => (r.itemId === id ? { ...r, itemName: patch.name! } : r))
    : state.requests;
  return { ...state, foundItems, requests };
}

export function foundItemStatus(
  item: Pick<FoundItem, 'id'>,
  requests: OwnershipRequest[],
): FoundItemStatus {
  const own = requests.filter((r) => r.itemId === item.id);
  if (own.some((r) => r.status === 'completed')) return 'returned';
  if (own.some((r) => r.status === 'handed')) return 'handed';
  if (own.some((r) => r.status === 'approved' || r.status === 'scheduled')) return 'returning';
  return 'storing';
}

// 08 요청자
export type RequestInput = Pick<
  OwnershipRequest,
  | 'itemId'
  | 'itemName'
  | 'storageName'
  | 'requesterName'
  | 'feature'
  | 'lostFrom'
  | 'lostTo'
  | 'lostPlace'
>;

export function addRequest(state: ActivityState, input: RequestInput, clock: Clock) {
  const request: OwnershipRequest = {
    ...input,
    id: clock.id,
    status: 'pending',
    createdAt: clock.now,
    messages: [],
    reports: [],
  };
  return { state: { ...state, requests: [request, ...state.requests] }, request };
}

/** 08.06: a pending request is withdrawn and disappears from both sides. */
export function cancelRequest(state: ActivityState, id: string) {
  requireStatus(requireRequest(state, id), ['pending']);
  return { ...state, requests: state.requests.filter((r) => r.id !== id) };
}

export function sendMessage(
  state: ActivityState,
  id: string,
  by: Party,
  text: string,
  clock: Clock,
) {
  const request = requireRequest(state, id);
  requireStatus(request, ['approved', 'scheduled', 'handed']);
  const trimmed = text.trim();
  if (!trimmed) throw new ActivityError('메시지를 입력해 주세요.');
  return replaceRequest(state, {
    ...request,
    messages: [...request.messages, { id: clock.id, by, text: trimmed, sentAt: clock.now }],
  });
}

/** 08.03-A / 08-B.02-B: either side proposes; the other side confirms. */
export function proposeAppointment(
  state: ActivityState,
  id: string,
  by: Party,
  appointment: Appointment,
) {
  const request = requireRequest(state, id);
  requireStatus(request, ['approved', 'scheduled']);
  return replaceRequest(state, { ...request, proposal: { ...appointment, by } });
}

export function confirmAppointment(state: ActivityState, id: string, by: Party) {
  const request = requireRequest(state, id);
  requireStatus(request, ['approved', 'scheduled']);
  if (!request.proposal) throw new ActivityError('확인할 약속 제안이 없어요.');
  if (request.proposal.by === by) throw new ActivityError('상대방이 확인해야 하는 제안이에요.');
  const { by: _by, ...appointment } = request.proposal;
  return replaceRequest(state, {
    ...request,
    proposal: undefined,
    appointment,
    status: 'scheduled',
  });
}

/** 08.04-C: the requester confirms receipt, which completes the return. */
export function confirmReceived(state: ActivityState, id: string, clock: Clock) {
  const request = requireRequest(state, id);
  requireStatus(request, ['scheduled', 'handed']);
  return replaceRequest(state, { ...request, status: 'completed', completedAt: clock.now });
}

export function reportSuspicious(state: ActivityState, id: string, report: SuspiciousReport) {
  const request = requireRequest(state, id);
  return replaceRequest(state, { ...request, reports: [...request.reports, report] });
}

// 08-B 보관자
export function approveRequest(state: ActivityState, id: string) {
  const request = requireRequest(state, id);
  requireStatus(request, ['pending']);
  return replaceRequest(state, { ...request, status: 'approved' });
}

export function rejectRequest(state: ActivityState, id: string) {
  const request = requireRequest(state, id);
  requireStatus(request, ['pending']);
  return replaceRequest(state, { ...request, status: 'rejected' });
}

/** 08-B.02-C: handing over the item; the requester still has to confirm receipt. */
export function markHanded(state: ActivityState, id: string, clock: Clock) {
  const request = requireRequest(state, id);
  requireStatus(request, ['approved', 'scheduled']);
  return replaceRequest(state, { ...request, status: 'handed', handedAt: clock.now });
}
