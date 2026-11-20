import test from 'node:test';
import assert from 'node:assert/strict';
import { appendInbox, emptyInbox, refreshInbox } from '../src/features/notifications/inboxState.ts';
const notice = (id, readAt = null) => ({
  id,
  itemId: id,
  itemName: id,
  reportId: 'r',
  createdAt: '2026-11-20',
  readAt,
});
test('새 알림 확인 후에도 더보기 내역을 유지하고 중복·읽음 상태를 갱신한다', () => {
  let s = refreshInbox(emptyInbox, { items: [notice('c'), notice('b')], nextCursor: 'b' });
  s = appendInbox(s, { items: [notice('b'), notice('a')], nextCursor: 'a' });
  s = refreshInbox(s, { items: [notice('d'), notice('c', 'read')], nextCursor: 'c' });
  assert.deepEqual(
    s.items.map((n) => n.id),
    ['d', 'c', 'b', 'a'],
  );
  assert.equal(s.items[1].readAt, 'read');
  assert.equal(s.nextCursor, 'a');
});
test('새 알림이 첫 페이지를 모두 채우면 중간 알림이 빠지지 않게 커서를 되돌린다', () => {
  const old = appendInbox(refreshInbox(emptyInbox, { items: [notice('c')], nextCursor: 'c' }), {
    items: [notice('b')],
    nextCursor: 'b',
  });
  const next = refreshInbox(old, { items: [notice('z'), notice('y')], nextCursor: 'y' });
  assert.deepEqual(
    next.items.map((n) => n.id),
    ['z', 'y'],
  );
  assert.equal(next.nextCursor, 'y');
  assert.equal(next.expanded, false);
});
test('전체 결과가 첫 페이지에 들어오면 삭제된 과거 내역을 남기지 않는다', () => {
  const old = appendInbox(emptyInbox, { items: [notice('old')], nextCursor: null });
  assert.deepEqual(refreshInbox(old, { items: [], nextCursor: null }).items, []);
});
