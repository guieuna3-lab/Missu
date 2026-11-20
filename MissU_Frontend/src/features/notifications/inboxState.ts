export type Notice = {
  id: string;
  reportId: string;
  itemId: string;
  itemName: string;
  createdAt: string;
  readAt: string | null;
};
export type InboxPage = { items: Notice[]; nextCursor: string | null };
export type InboxState = InboxPage & { loaded: boolean; expanded: boolean };
export const emptyInbox: InboxState = {
  items: [],
  nextCursor: null,
  loaded: false,
  expanded: false,
};

/** 새 알림은 위에 추가하되 더보기로 읽던 과거 내역과 읽음 표시를 유지합니다. */
export function refreshInbox(old: InboxState, page: InboxPage): InboxState {
  const ids = new Set(page.items.map((n) => n.id));
  // 두 갱신 사이에 50개 넘게 도착하면 중간 알림을 건너뛰지 않도록 페이지를 다시 시작합니다.
  const connected = !old.items.length || page.items.some((n) => n.id === old.items[0].id);
  if (!old.expanded || !connected || !page.nextCursor)
    return { ...page, loaded: true, expanded: false };
  return { ...old, items: [...page.items, ...old.items.filter((n) => !ids.has(n.id))] };
}
export function appendInbox(old: InboxState, page: InboxPage): InboxState {
  const ids = new Set(old.items.map((n) => n.id));
  return {
    items: [...old.items, ...page.items.filter((n) => !ids.has(n.id))],
    nextCursor: page.nextCursor,
    loaded: true,
    expanded: true,
  };
}
