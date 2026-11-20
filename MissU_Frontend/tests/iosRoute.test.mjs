import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { usableLocation } from '../src/features/nearby/locationFix.ts';

const source = readFileSync(
  new URL('../src/features/nearby/backgroundRoute.ios.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const token = 'synthetic-token';
function phone() {
  const store = new Map(),
    sent = [],
    app = { currentState: 'active' };
  const state = { running: false, allow: true, online: true, now: Date.now() };
  let deliver;
  class ApiError extends Error {}
  const require = (name) =>
    ({
      expo: { isRunningInExpoGo: () => false },
      'expo-crypto': { randomUUID },
      'react-native': { AppState: app },
      './locationFix': { usableLocation },
      'expo-secure-store': {
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 42,
        getItemAsync: async (k) => store.get(k) ?? null,
        setItemAsync: async (k, v, opts) => {
          assert.equal(opts.keychainAccessible, 42);
          assert(Buffer.byteLength(v) < 2048);
          store.set(k, v);
        },
        deleteItemAsync: async (k) => store.delete(k),
      },
      'expo-task-manager': {
        isTaskDefined: () => false,
        isAvailableAsync: async () => true,
        defineTask: (_, fn) => {
          deliver = fn;
        },
      },
      'expo-location': {
        Accuracy: { High: 4 },
        ActivityType: { Other: 1 },
        hasServicesEnabledAsync: async () => true,
        requestForegroundPermissionsAsync: async () => ({ granted: true }),
        requestBackgroundPermissionsAsync: async () => ({
          granted: state.allow,
          ios: { scope: state.allow ? 'always' : 'whenInUse', accuracy: 'full' },
        }),
        startLocationUpdatesAsync: async (_, opts) => {
          assert.equal(opts.showsBackgroundLocationIndicator, true);
          state.running = true;
        },
        stopLocationUpdatesAsync: async () => {
          state.running = false;
        },
        hasStartedLocationUpdatesAsync: async () => state.running,
      },
      '@/lib/backend': {
        ApiError,
        api: async (path, request) => {
          sent.push({ path, body: JSON.parse(request.body), auth: request.headers.Authorization });
          if (!state.online) throw new Error('offline');
        },
      },
    })[name];
  function load() {
    const exports = {};
    runInNewContext(js, {
      exports,
      require,
      Date: class extends Date {
        static now() {
          return state.now;
        }
      },
    });
    return exports;
  }
  const device = load(),
    start = async () => {
      device.reconcileRouteAccount(token, 'same-account');
      await device.routeCommand('prepare', { token });
      const id = randomUUID();
      await device.routeCommand('start', {
        token,
        id,
        start: state.now - 300000,
        end: state.now + 3600000,
      });
      return id;
    };
  const fix = (time, accuracy = 20) => ({
    timestamp: time,
    coords: { latitude: 37, longitude: 127, accuracy },
  });
  return {
    device,
    state,
    app,
    store,
    sent,
    load,
    start,
    fix,
    deliver: (locations) => deliver({ data: { locations } }),
  };
}
test('screen lock and delayed delivery preserve measurement times; explicit stop ends collection', async () => {
  const p = phone(),
    id = await p.start(),
    now = p.state.now;
  p.app.currentState = 'background';
  await p.deliver([
    p.fix(now - 30000),
    p.fix(now - 90000),
    p.fix(now - 60000, 500),
    p.fix(now - 89000),
  ]);
  assert.equal(p.state.running, true);
  assert.equal(p.sent[0].path, '/me/routes/recordings/' + id + '/points');
  assert.deepEqual(
    p.sent[0].body.points.map((v) => v.recordedAt),
    [now - 90000, now - 30000].map((t) => new Date(t).toISOString()),
  );
  p.app.currentState = 'active';
  await p.device.routeCommand('stop', { token });
  await flush();
  await p.deliver([p.fix(now)]);
  assert.equal(p.state.running, false);
  assert.equal(p.sent.filter((v) => v.path.endsWith('/points')).length, 1);
  assert(p.sent.at(-1).path.endsWith('/stop'));
  assert.equal(p.store.size, 0);
});
test('offline points survive a new JS runtime and retry with the original IDs', async () => {
  const p = phone();
  await p.start();
  p.state.online = false;
  await p.deliver([p.fix(p.state.now - 20000)]);
  const id = p.sent[0].body.points[0].clientPointId;
  p.load();
  p.state.online = true;
  p.app.currentState = 'background';
  await p.deliver([]);
  assert.equal(p.sent[1].body.points[0].clientPointId, id);
  assert.equal(p.sent[1].auth, 'Bearer ' + token);
});
test('denial, logout, account switch, and expired sessions cannot upload new locations', async () => {
  const p = phone();
  p.state.allow = false;
  await assert.rejects(p.start(), /항상/);
  assert.equal(p.state.running, false);
  assert.equal(p.store.size, 0);
  p.state.allow = true;
  await p.start();
  p.device.reconcileRouteAccount('new-token', 'different-account');
  await flush();
  assert.equal(p.state.running, false);
  await p.deliver([p.fix(p.state.now)]);
  assert(!p.sent.some((v) => v.path.endsWith('/points')));
  await p.start();
  p.state.now += 3600001;
  await p.deliver([p.fix(p.state.now)]);
  assert.equal(p.state.running, false);
  assert.equal(p.store.size, 0);
  await p.start();
  p.device.reconcileRouteAccount(null);
  await flush();
  assert.equal(p.state.running, false);
});

test('renewed login for the same account keeps the route and uses the new token', async () => {
  const p = phone();
  const id = await p.start();
  p.device.reconcileRouteAccount('renewed-token', 'same-account');
  await flush();
  assert.equal(p.state.running, true);
  await p.deliver([p.fix(p.state.now - 20000)]);
  assert.equal(p.sent[0].auth, 'Bearer renewed-token');
  assert.equal((await p.device.routeCommand('status', { token: 'renewed-token' })).id, id);
  await p.device.routeCommand('stop', { token: 'renewed-token' });
  await flush();
  assert.equal(p.state.running, false);
  assert.equal(p.store.size, 0);
});
