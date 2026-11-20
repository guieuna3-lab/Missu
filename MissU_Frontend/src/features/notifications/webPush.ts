import { randomUUID } from 'expo-crypto';
import { api } from '@/lib/backend';

const storeName = 'missu-push-state-v1';
const statePath = '/__missu_push_state__';
type State = { account: string; binding: string };
type Device = { token: string; binding: string };
let currentAccount: string | null = null;
let generation = 0;
let pending: Promise<unknown> = Promise.resolve();
function select(account: string | null) {
  if (currentAccount !== account) {
    currentAccount = account;
    generation++;
  }
  return generation;
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.then(work, work);
  pending = run.catch(() => undefined);
  return run;
}
function check(run: number) {
  if (run !== generation) throw new Error('로그인이 변경됐어요. 다시 알림을 켜 주세요.');
}
export function supportsWebPush() {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window) ||
    !('caches' in window)
  )
    return false;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return (
    !ios ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
async function read() {
  const cache = await caches.open(storeName);
  const saved = await cache.match(statePath);
  return saved ? ((await saved.json()) as State) : null;
}
async function write(state: State) {
  const cache = await caches.open(storeName);
  await cache.put(statePath, new Response(JSON.stringify(state)));
}
async function registration() {
  const r = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  if (r.active) return r;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('미슈를 다시 열고 알림을 켜 주세요.')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function encode(s: PushSubscription) {
  return (
    'webpush:' +
    btoa(JSON.stringify(s.toJSON())).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}
async function accountHash(account: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}
async function register(r: ServiceWorkerRegistration, state: State, token: string, run: number) {
  check(run);
  const sub = await r.pushManager.getSubscription();
  if (!sub) return false;
  const device = { token: encode(sub), binding: state.binding };
  await api('/notifications/devices', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(device),
  });
  check(run);
  await write(state);
  return true;
}
async function clear(): Promise<Device | undefined> {
  const saved = await read();
  const cache = await caches.open(storeName);
  await cache.delete(statePath);
  const r = await navigator.serviceWorker.getRegistration('/');
  if (!r) return;
  for (const notice of await r.getNotifications({ tag: 'missu-matches' })) notice.close();
  const sub = await r.pushManager.getSubscription();
  if (!sub) return;
  const device = saved ? { token: encode(sub), binding: saved.binding } : undefined;
  await sub.unsubscribe();
  return device;
}
export function clearWebPush() {
  select(null);
  return serial(clear);
}
export function enableWebPush(account: string, token: string) {
  const run = select(account);
  // iPhone은 버튼을 누른 동작 안에서 권한 요청을 시작해야 합니다.
  const permission = Notification.requestPermission();
  return serial(async () => {
    if ((await permission) !== 'granted')
      throw new Error('휴대폰 설정에서 미슈 알림을 허용해 주세요.');
    check(run);
    const config = await api<{ data: { publicKey: string | null } }>('/notifications/web-push', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!config.data.publicKey)
      throw new Error('휴대폰 알림 연결을 준비 중이에요. 잠시 후 다시 시도해 주세요.');
    const identity = await accountHash(account);
    let saved = await read();
    if (saved && saved.account !== identity) {
      await clear();
      saved = null;
    }
    const r = await registration();
    const key = config.data.publicKey;
    const bytes = Uint8Array.from(
      atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    if (!(await r.pushManager.getSubscription()))
      await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    check(run);
    return register(r, saved ?? { account: identity, binding: randomUUID() }, token, run);
  });
}
export function syncWebPush(account: string, token: string) {
  const run = select(account);
  return serial(async () => {
    check(run);
    const saved = await read();
    if (!saved) return;
    if (saved.account !== (await accountHash(account))) {
      await clear();
      return;
    }
    if (Notification.permission !== 'granted') {
      await clear();
      return;
    }
    await register(await registration(), saved, token, run);
  });
}
