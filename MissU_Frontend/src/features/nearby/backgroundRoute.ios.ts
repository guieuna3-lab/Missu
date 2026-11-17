import { isRunningInExpoGo } from 'expo';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import * as Keychain from 'expo-secure-store';
import * as Tasks from 'expo-task-manager';
import { AppState } from 'react-native';
import { api, ApiError } from '@/lib/backend';
import { usableLocation } from './locationFix';

export const backgroundRoute = !isRunningInExpoGo();
export const stopHint = '미슈의 이동 경로 화면에서 언제든 중지할 수 있어요.';
const task = 'missu.personal-route.ios.v1';
const options = { keychainAccessible: Keychain.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const day = 24 * 60 * 60 * 1000;
type Session = {
  id: string;
  token: string;
  start: number;
  end: number;
  stopped: boolean;
  first: number;
  next: number;
  saved: number;
  last: number;
};
type Point = {
  clientPointId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  accuracyM: number;
};
type State = { id?: string; saved?: number; message?: string };
type Args = { token: string; id?: string; start?: number; end?: number };
const read = async (): Promise<Session | null> => {
  const value = await Keychain.getItemAsync(task, options);
  return value ? JSON.parse(value) : null;
};
const write = (s: Session) => Keychain.setItemAsync(task, JSON.stringify(s), options);
const key = (s: Session, i: number) => task + '.' + s.id + '.' + i;

// 잠금 화면 콜백, 중지, 계정 변경이 같은 키체인 기록을 동시에 수정하지 않게 합니다.
// 네트워크 요청은 잠금 밖에서 실행해 통신이 느려도 센서를 즉시 중지할 수 있게 합니다.
let queue = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
let account: string | null | undefined;
let prepared: { token: string; until: number } | undefined;
let retryAt = 0;
let upload: Promise<void> | undefined;
let dirty = false;

async function stopSensor() {
  if (await Location.hasStartedLocationUpdatesAsync(task))
    await Location.stopLocationUpdatesAsync(task);
}
async function stopLocal(s: Session) {
  s.stopped = true;
  await write(s);
  await stopSensor();
}
async function erase(s: Session) {
  for (let i = s.first; i < s.next; i++) await Keychain.deleteItemAsync(key(s, i), options);
  await Keychain.deleteItemAsync(task, options);
}
function requestStop(s: Session) {
  return api('/me/routes/recordings/' + s.id + '/stop', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

// 실제로 서버가 받은 묶음만 지웁니다. 앱이 전송 중에 종료돼도 같은 점 ID로 재시도합니다.
async function drain() {
  while (true) {
    const job = await locked(async () => {
      const s = await read();
      if (!s) return;
      if (Date.now() >= s.end) {
        await stopLocal(s);
        await erase(s);
        return;
      }
      if (s.first === s.next) return s.stopped ? { s, page: null } : undefined;
      const page = await Keychain.getItemAsync(key(s, s.first), options);
      return { s, page: page ? (JSON.parse(page) as Point[]) : [] };
    });
    if (!job) return;
    const { s, page } = job;
    try {
      if (page === null) await requestStop(s);
      else if (page.length)
        await api('/me/routes/recordings/' + s.id + '/points', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: page }),
        });
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403, 404, 409].includes(error.status)) {
        retryAt = Date.now() + 15000;
        return;
      }
      await locked(async () => {
        const live = await read();
        if (live?.id === s.id) {
          await stopLocal(live);
          await erase(live);
        }
      });
      return;
    }
    await locked(async () => {
      const live = await read();
      if (!live || live.id !== s.id || live.first !== s.first) return;
      if (page === null) {
        await erase(live);
        return;
      }
      await Keychain.deleteItemAsync(key(s, s.first), options);
      live.first++;
      live.saved += page.length;
      await write(live);
    });
  }
}
function sync() {
  dirty = true;
  if (!upload && Date.now() >= retryAt) {
    dirty = false;
    upload = drain().finally(() => {
      upload = undefined;
      if (dirty && Date.now() >= retryAt) void sync().catch(() => undefined);
    });
  }
  return upload ?? Promise.resolve();
}
async function record(locations: Location.LocationObject[]) {
  await locked(async () => {
    const s = await read();
    if (!s) {
      await stopSensor();
      return;
    }
    if (s.stopped || Date.now() >= s.end) {
      await stopLocal(s);
      return;
    }
    const points: Point[] = [];
    for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      const time = loc.timestamp;
      // iOS가 잠금 중 모아 전달한 점은 실제 측정 시각으로 저장합니다.
      if (
        time < s.start ||
        time >= s.end ||
        time > Date.now() + 1000 ||
        time - s.last < 15000 ||
        !usableLocation(loc, time) ||
        loc.coords.accuracy === null
      )
        continue;
      s.last = time;
      points.push({
        clientPointId: randomUUID(),
        recordedAt: new Date(time).toISOString(),
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracyM: Math.round(loc.coords.accuracy),
      });
    }
    if (!points.length) return;
    // 한 키체인 항목이 지나치게 커지지 않도록 작은 묶음으로 나눕니다.
    const first = s.next;
    s.next += Math.ceil(points.length / 8);
    await write(s);
    for (let i = 0; i < points.length; i += 8) {
      await Keychain.setItemAsync(
        key(s, first + i / 8),
        JSON.stringify(points.slice(i, i + 8)),
        options,
      );
    }
  });
  await sync();
}

if (backgroundRoute && !Tasks.isTaskDefined(task)) {
  Tasks.defineTask<{ locations: Location.LocationObject[] }>(task, async ({ data, error }) => {
    if (!error && data) return record(data.locations);
    const perm = await Location.getBackgroundPermissionsAsync();
    if (!perm.granted) {
      await locked(async () => {
        const s = await read();
        if (s) await stopLocal(s);
        else await stopSensor();
      });
      await sync();
    }
  });
}

export function reconcileRouteAccount(token: string | null) {
  if (!backgroundRoute) return;
  account = token;
  if (prepared?.token !== token) prepared = undefined;
  // 새 로그인 세션이 이전 계정의 저장 대기 중인 위치나 토큰을 재사용하지 않습니다.
  void locked(async () => {
    const s = await read();
    if (s && s.token !== account) {
      await stopLocal(s);
      await erase(s);
      void requestStop(s).catch(() => undefined);
    }
  }).catch(() => undefined);
}

export async function routeCommand(command: string, args: Args): Promise<State> {
  const { token } = args;
  if (!backgroundRoute || !token) throw new Error('아이폰용 미슈에 로그인해 주세요.');
  if (command === 'prepare') {
    if (account !== token || AppState.currentState !== 'active')
      throw new Error('미슈 화면에서 다시 시작해 주세요.');
    if (!(await Tasks.isAvailableAsync()) || !(await Location.hasServicesEnabledAsync()))
      throw new Error('아이폰의 위치 서비스를 켜 주세요.');
    if (!(await Location.requestForegroundPermissionsAsync()).granted)
      throw new Error('설정에서 미슈의 위치 접근을 허용해 주세요.');
    const perm = await Location.requestBackgroundPermissionsAsync();
    if (!perm.granted || perm.ios?.scope !== 'always')
      throw new Error(
        '설정 → 개인정보 보호 및 보안 → 위치 서비스 → 미슈에서 ‘항상’을 허용해 주세요.',
      );
    if (perm.ios?.accuracy === 'reduced')
      throw new Error('미슈의 위치 설정에서 ‘정확한 위치’를 켜 주세요.');
    if (account !== token) throw new Error('다시 로그인해 주세요.');
    const prior = await locked(read);
    if (prior && prior.end > Date.now()) {
      void sync().catch(() => undefined);
      throw new Error(
        prior.stopped
          ? '이전 경로의 저장을 마치고 다시 시작해 주세요.'
          : '이미 경로를 기록하고 있어요.',
      );
    }
    if (prior)
      await locked(async () => {
        const s = await read();
        if (s?.id === prior.id) {
          await stopLocal(s);
          await erase(s);
        }
      });
    prepared = { token, until: Date.now() + 180000 };
    return {};
  }
  if (command === 'start') {
    return locked(async () => {
      const { id, start, end } = args;
      if (
        account !== token ||
        prepared?.token !== token ||
        prepared.until < Date.now() ||
        AppState.currentState !== 'active'
      )
        throw new Error('이동 경로 화면에서 다시 시작해 주세요.');
      prepared = undefined;
      if (
        !id ||
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= Date.now() ||
        start >= end ||
        end - start > day ||
        (await read())
      )
        throw new Error('기록 상태를 확인하고 다시 시작해 주세요.');
      const s: Session = {
        id,
        token,
        start,
        end,
        first: 0,
        next: 0,
        last: 0,
        saved: 0,
        stopped: false,
      };
      await write(s);
      try {
        await Location.startLocationUpdatesAsync(task, {
          accuracy: Location.Accuracy.High,
          distanceInterval: 5,
          activityType: Location.ActivityType.Other,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
        });
      } catch (error) {
        await stopLocal(s);
        await erase(s);
        throw error;
      }
      return { id, saved: 0 };
    });
  }
  const state = await locked(async (): Promise<State> => {
    const s = await read();
    if (!s || s.token !== token) return {};
    if (
      command === 'stop' ||
      Date.now() >= s.end ||
      (!s.stopped && !(await Location.hasStartedLocationUpdatesAsync(task)))
    )
      await stopLocal(s);
    return {
      id: s.stopped ? undefined : s.id,
      saved: s.saved,
      message: s.stopped
        ? '휴대폰의 위치 기록을 중지했어요.'
        : s.next > s.first
          ? '측정한 위치를 내 계정에 저장하고 있어요.'
          : '아이폰이 이동 경로를 기록하고 있어요.',
    };
  });
  void sync().catch(() => undefined);
  return state;
}
