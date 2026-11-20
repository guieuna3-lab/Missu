import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {};
const values = new Map();
globalThis.localStorage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
};
const { saveSession, restoreSession, clearSavedSession } =
  await import('../src/features/auth/persistentSession.web.ts');
const session = {
  profile: { email: 'qa@example.test', name: '시험' },
  accessToken: 'opaque-access',
};
test('웹 저장소에는 토큰 없이 상태만 기록하고 동일 출처 쿠키로 복원한다', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/restore')
      ? new Response(
          JSON.stringify({
            data: {
              user: { nickname: '변경닉네임', email: 'qa@example.test', phoneVerified: true },
              accessToken: 'new-access',
            },
          }),
        )
      : new Response(null, { status: 204 });
  };
  await saveSession(session);
  assert.deepEqual([...values.values()], ['active']);
  const restored = await restoreSession();
  assert.equal(restored.profile.name, '변경닉네임');
  assert.equal(restored.accessToken, 'new-access');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers['X-Missu-Session'], '1');
});
test('오프라인 로그아웃 뒤에는 복원을 금지하고 다음 시작에 폐기를 재시도한다', async () => {
  globalThis.fetch = async () => {
    throw Error('offline');
  };
  await assert.rejects(clearSavedSession());
  assert.equal(values.get('missu.login.v1'), 'blocked');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(null, { status: 204 });
  };
  assert.equal(await restoreSession(), null);
  assert.deepEqual(calls, ['/session-api/forget']);
});
test('늦게 끝난 로그인 유지 저장이 로그아웃 금지 표시를 덮지 않는다', async () => {
  let finish, started;
  const ready = new Promise((r) => (started = r));
  globalThis.fetch = async (url) => {
    if (url.endsWith('/save')) {
      started();
      await new Promise((r) => (finish = r));
      return new Response(null, { status: 204 });
    }
    throw Error('offline');
  };
  const saving = saveSession(session);
  await ready;
  const clearing = clearSavedSession();
  finish();
  await saving;
  await assert.rejects(clearing);
  assert.equal(values.get('missu.login.v1'), 'blocked');
});
