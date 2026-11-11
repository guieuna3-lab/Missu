import { randomUUID } from 'expo-crypto';
import { api } from '@/lib/backend';
import { formatDateTimeRange } from '@/lib/dateTime';
import type { Appointment, ChatMessage, OwnershipRequest, Party, RequestStatus } from './types';

type Claim = {
  id: string;
  itemId: string;
  itemName: string;
  storageName: string;
  requesterNickname: string;
  viewerRole: Party;
  features: string;
  lostInfo: string | null;
  lostTime: { start: string; end: string } | null;
  lostLocation: { label: string } | null;
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED' | 'HANDED_OVER' | 'RETURNED';
  decisionReason: string | null;
  appointment: (Appointment & { id: string; by: Party; confirmed: boolean }) | null;
  handedOverAt: string | null;
  receivedAt: string | null;
};
const statuses: Record<Claim['status'], RequestStatus> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CLOSED: 'rejected',
  HANDED_OVER: 'handed',
  RETURNED: 'completed',
};
function present(row: Claim): OwnershipRequest {
  const appointment = row.appointment;
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.itemName,
    storageName: row.storageName,
    requesterName: row.requesterNickname,
    viewerRole: row.viewerRole,
    feature: row.features,
    lostInfo:
      row.lostInfo ??
      [
        row.lostTime && formatDateTimeRange(row.lostTime.start, row.lostTime.end),
        row.lostLocation?.label,
      ]
        .filter(Boolean)
        .join(' · '),
    status:
      row.status === 'APPROVED' && appointment?.confirmed ? 'scheduled' : statuses[row.status],
    closedReason:
      row.status === 'CLOSED'
        ? (row.decisionReason ?? '다른 요청으로 반환이 진행 중이에요.')
        : undefined,
    createdAt: row.createdAt,
    proposal: appointment && !appointment.confirmed ? appointment : undefined,
    appointment: appointment?.confirmed ? appointment : undefined,
    handedAt: row.handedOverAt ?? undefined,
    completedAt: row.receivedAt ?? undefined,
    messages: [],
    reports: [],
  };
}
type MessagePage = {
  messages: { id: string; senderRole: Party; body: string; sentAt: string }[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
};
const asMessages = (page: MessagePage): ChatMessage[] =>
  page.messages.map((m) => ({ id: m.id, by: m.senderRole, text: m.body, sentAt: m.sentAt }));

// 재시도 키와 대화 커서는 이 로그인 세션에서만 유지합니다.
export function createClaimClient(token: string) {
  const headers = { Authorization: 'Bearer ' + token };
  const attempts = new Map<string, string>();
  const chats = new Map<string, { messages: ChatMessage[]; cursor: string | null }>();
  async function get<T>(path: string) {
    return (await api<{ data: T }>(path, { headers })).data;
  }
  async function page(id: string, query: string) {
    return get<MessagePage>('/claims/' + id + '/messages' + query);
  }
  async function messages(id: string) {
    const prior = chats.get(id);
    let items: ChatMessage[], cursor: string | null;
    if (prior?.cursor) {
      items = [...prior.messages];
      cursor = prior.cursor;
      let next: MessagePage;
      do {
        next = await page(id, '?after=' + encodeURIComponent(cursor!));
        items.push(...asMessages(next));
        cursor = next.nextCursor;
      } while (next.hasMore && cursor);
    } else {
      let batch = await page(id, '');
      items = asMessages(batch);
      cursor = batch.nextCursor;
      while (batch.previousCursor) {
        batch = await page(id, '?before=' + encodeURIComponent(batch.previousCursor));
        items = [...asMessages(batch), ...items];
      }
    }
    chats.set(id, { messages: items, cursor });
    return items;
  }
  async function list() {
    let cursor: string | null = null;
    const result: OwnershipRequest[] = [];
    do {
      const route: string = '/me/claims' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
      const response: { data: Claim[]; meta: { nextCursor: string | null } } = await api(route, {
        headers,
      });
      result.push(
        ...response.data
          .filter((row) => !(row.status === 'CLOSED' && row.decisionReason === '요청자 취소'))
          .map(present),
      );
      cursor = response.meta.nextCursor;
    } while (cursor);
    return result;
  }
  async function mutate(path: string, body: object, claimId?: string) {
    const signature = JSON.stringify([path, body]);
    const key = attempts.get(signature) ?? randomUUID();
    attempts.set(signature, key);
    const payload = path.endsWith('/messages') ? { ...body, clientMessageId: key } : body;
    const response = await api<{
      data: { claimId?: string; id: string; body: string; sentAt: string };
    }>(path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    const id = claimId ?? response.data.claimId!;
    const claim = present(await get<Claim>('/claims/' + id));
    if (path.endsWith('/messages'))
      claim.messages = [
        {
          id: response.data.id,
          by: claim.viewerRole!,
          text: response.data.body,
          sentAt: response.data.sentAt,
        },
      ];
    attempts.delete(signature);
    return claim;
  }
  return { list, messages, mutate };
}
