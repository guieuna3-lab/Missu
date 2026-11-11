import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyActivity, sampleActivity } from '../src/lib/activity/fixtures.ts';
import {
  ActivityError,
  addFoundItem,
  addLostReport,
  addRequest,
  approveRequest,
  cancelRequest,
  confirmAppointment,
  confirmReceived,
  deleteLostReport,
  foundItemStatus,
  markHanded,
  proposeAppointment,
  rejectRequest,
  sendMessage,
  updateFoundItem,
  updateLostReport,
} from '../src/lib/activity/transitions.ts';

const clock = { id: 'new-1', now: '2026-10-07T10:00:00+09:00' };
const appointment = { place: '중앙도서관 1층 안내데스크', date: '2026.10.06', time: '17:00' };

test('lost reports can be added, edited and deleted without touching the source state', () => {
  const before = JSON.stringify(emptyActivity);
  const { state, report } = addLostReport(
    emptyActivity,
    {
      category: 'WALLET',
      name: '검정 반지갑',
      feature: '',
      lostFrom: '2026-10-05T09:00:00+09:00',
      lostTo: '2026-10-05T09:00:00+09:00',
      place: { name: '중앙역', detail: '중앙역 2번 출구' },
    },
    clock,
  );
  assert.equal(report.id, 'new-1');
  assert.equal(state.lostReports.length, 1);
  const edited = updateLostReport(state, 'new-1', { name: '갈색 반지갑' });
  assert.equal(edited.lostReports[0].name, '갈색 반지갑');
  assert.equal(deleteLostReport(edited, 'new-1').lostReports.length, 0);
  assert.throws(() => deleteLostReport(edited, 'missing'), ActivityError);
  assert.equal(JSON.stringify(emptyActivity), before);
});

test('registering a found item keeps request item names in sync when renamed', () => {
  const { state, item } = addFoundItem(
    sampleActivity,
    {
      category: 'KEY',
      name: '현대 자동차 키',
      foundAt: '2026-10-05T11:30:00+09:00',
      place: { name: '중앙역', detail: '중앙역 2번 출구' },
      photos: 2,
      storage: '학생회관 안내데스크',
      pickupGuide: '',
      privateFeature: '',
    },
    clock,
  );
  assert.equal(item.id, 'new-1');
  assert.equal(state.foundItems.length, 2);
  const renamed = updateFoundItem(state, 'buds', { name: '갤럭시 버즈2 프로' });
  assert.equal(renamed.requests[0].itemName, '갤럭시 버즈2 프로');
});

test('requester flow: pending → approved → scheduled → completed', () => {
  let state = sampleActivity;
  const id = 'request-1';
  assert.equal(foundItemStatus({ id: 'buds' }, state.requests), 'storing');
  assert.throws(() => sendMessage(state, id, 'requester', '안녕하세요', clock), ActivityError);

  state = approveRequest(state, id);
  assert.equal(state.requests[0].status, 'approved');
  assert.equal(foundItemStatus({ id: 'buds' }, state.requests), 'returning');
  assert.throws(() => approveRequest(state, id), ActivityError);

  state = sendMessage(state, id, 'holder', ' 안내데스크에서 확인 후 전달해 드릴게요. ', clock);
  assert.deepEqual(
    state.requests[0].messages.map((m) => [m.by, m.text]),
    [['holder', '안내데스크에서 확인 후 전달해 드릴게요.']],
  );
  assert.throws(() => sendMessage(state, id, 'requester', '   ', clock), ActivityError);

  state = proposeAppointment(state, id, 'holder', appointment);
  assert.throws(() => confirmAppointment(state, id, 'holder'), ActivityError);
  state = confirmAppointment(state, id, 'requester');
  assert.equal(state.requests[0].status, 'scheduled');
  assert.deepEqual(state.requests[0].appointment, appointment);
  assert.equal(state.requests[0].proposal, undefined);

  state = confirmReceived(state, id, clock);
  assert.equal(state.requests[0].status, 'completed');
  assert.equal(state.requests[0].completedAt, clock.now);
  assert.equal(foundItemStatus({ id: 'buds' }, state.requests), 'returned');
});

test('holder flow: reject, hand over before scheduling, and cancel rules', () => {
  const id = 'request-1';
  const rejected = rejectRequest(sampleActivity, id);
  assert.equal(rejected.requests[0].status, 'rejected');
  assert.throws(() => markHanded(rejected, id, clock), ActivityError);

  const approved = approveRequest(sampleActivity, id);
  const handed = markHanded(approved, id, clock);
  assert.equal(handed.requests[0].status, 'handed');
  assert.equal(foundItemStatus({ id: 'buds' }, handed.requests), 'handed');
  assert.throws(() => proposeAppointment(handed, id, 'holder', appointment), ActivityError);
  assert.equal(confirmReceived(handed, id, clock).requests[0].status, 'completed');

  assert.equal(cancelRequest(sampleActivity, id).requests.length, 0);
  assert.throws(() => cancelRequest(approved, id), ActivityError);
});

test('a new request starts pending with empty chat and report lists', () => {
  const { state, request } = addRequest(
    emptyActivity,
    {
      itemId: 'key',
      itemName: '현대 자동차 키',
      storageName: '학생회관',
      requesterName: '홍길동',
      feature: '키링에 파란 리본',
      lostInfo: '2026.10.05 10:00~12:00 · 학생식당 앞',
    },
    clock,
  );
  assert.equal(request.status, 'pending');
  assert.deepEqual(request.messages, []);
  assert.deepEqual(request.reports, []);
  assert.equal(state.requests[0], request);
});
