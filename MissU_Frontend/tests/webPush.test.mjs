import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID, webcrypto } from 'node:crypto';
import ts from 'typescript';

function browser() {
  const entries = new Map(),
    calls = [],
    notices = [];
  let subscribed = null,
    prompts = 0,
    unsubscribed = 0;
  const cache = {
    match: async (key) => (entries.has(key) ? new Response(entries.get(key)) : undefined),
    put: async (key, value) => entries.set(key, await value.text()),
    delete: async (key) => entries.delete(key),
  };
  const caches = { open: async () => cache };
  const Notification = {
    permission: 'granted',
    requestPermission: async () => {
      prompts++;
      return Notification.permission;
    },
  };
  const registration = {
    active: true,
    getNotifications: async () => [],
    pushManager: {
      getSubscription: async () => subscribed,
      subscribe: async () => {
        subscribed = {
          toJSON: () => ({
            endpoint: 'https://web.push.apple.com/test',
            keys: { p256dh: 'public', auth: 'auth' },
          }),
          unsubscribe: async () => {
            unsubscribed++;
            subscribed = null;
            return true;
          },
        };
        return subscribed;
      },
    },
    showNotification: async (title, options) => notices.push({ title, options }),
  };
  const navigator = {
    userAgent: 'iPhone',
    serviceWorker: {
      register: async () => registration,
      getRegistration: async () => registration,
      ready: Promise.resolve(registration),
    },
  };
  const window = { PushManager: {}, Notification, caches, matchMedia: () => ({ matches: true }) };
  const exports = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/features/notifications/webPush.ts', import.meta.url), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: (name) =>
        name === 'expo-crypto'
          ? { randomUUID }
          : {
              api: async (path, request) => {
                calls.push({ path, request });
                return { data: { publicKey: 'B'.repeat(87) } };
              },
            },
      navigator,
      window,
      Notification,
      caches,
      crypto: webcrypto,
      TextEncoder,
      Response,
      btoa,
      atob,
      setTimeout,
      clearTimeout,
    },
  );
  return {
    ...exports,
    entries,
    calls,
    notices,
    caches,
    registration,
    Notification,
    stats: () => ({ prompts, unsubscribed }),
    window,
  };
}
test('iPhone 홈 화면에서 명시적으로 켜야 권한을 요청하고 재실행은 다시 요청하지 않는다', async () => {
  const b = browser();
  await b.syncWebPush('user-a', 'token');
  assert.equal(b.stats().prompts, 0);
  assert.equal(b.supportsWebPush(), true);
  b.window.matchMedia = () => ({ matches: false });
  assert.equal(b.supportsWebPush(), false);
  await b.enableWebPush('user-a', 'token');
  assert.equal(b.stats().prompts, 1);
  await b.syncWebPush('user-a', 'refreshed');
  assert.equal(b.stats().prompts, 1);
  const device = await b.clearWebPush();
  assert.match(device.token, /^webpush:/);
  assert.equal(b.entries.size, 0);
  assert.equal(b.stats().unsubscribed, 1);
});
test('계정 변경은 이전 구독을 끊고 이전 요청이 로그아웃 뒤 다시 활성화되지 않는다', async () => {
  const b = browser();
  await b.enableWebPush('a', 'a');
  await b.syncWebPush('b', 'b');
  assert.equal(b.entries.size, 0);
  assert.equal(b.stats().unsubscribed, 1);
  const pending = b.enableWebPush('b', 'b');
  const logout = b.clearWebPush();
  await assert.rejects(pending, /로그인이 변경/);
  await logout;
  assert.equal(b.entries.size, 0);
});
test('서비스워커는 현재 계정의 알림만 표시하고 클릭하면 고정된 알림 목록을 연다', async () => {
  const b = browser(),
    handlers = {},
    opened = [];
  await b.enableWebPush('a', 'token');
  const state = JSON.parse([...b.entries.values()][0]);
  runInNewContext(readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8'), {
    caches: b.caches,
    URL,
    self: {
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
      registration: b.registration,
      location: { origin: 'https://missu-web.onrender.com' },
      clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) },
    },
  });
  const dispatch = async (name, event) => {
    let done;
    handlers[name]({
      ...event,
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
  };
  await dispatch('push', {
    data: { json: () => ({ binding: 'old', notificationId: randomUUID() }) },
  });
  assert.equal(b.notices.length, 0);
  await dispatch('push', {
    data: {
      json: () => ({
        binding: state.binding,
        notificationId: randomUUID(),
        url: 'https://evil.test',
      }),
    },
  });
  assert.equal(b.notices.length, 1);
  await dispatch('notificationclick', {
    notification: { close() {}, data: { binding: state.binding } },
  });
  assert.deepEqual(opened, ['https://missu-web.onrender.com/notifications']);
  await b.clearWebPush();
  await dispatch('push', {
    data: { json: () => ({ binding: state.binding, notificationId: randomUUID() }) },
  });
  assert.equal(b.notices.length, 1);
});
