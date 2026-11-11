import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { LocationObject, LocationSubscription } from 'expo-location';
import { ActionButton } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { StreetMap } from './StreetMap';
import { campus, mapApi, type Coordinates, type RoutePoint } from './mapData';
import { readDeviceLocation, watchDeviceLocation } from './deviceLocation';
import { usableLocation } from './locationFix';

function seoulDay(offset: number) {
  return new Date(Date.now() + 9 * 3600000 - offset * 86400000).toISOString().slice(0, 10);
}
type Status = { policyVersion: string; active: { id: string } | null };
type Sample = {
  clientPointId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  accuracyM: number;
};
const noPoints: RoutePoint[] = [];
export function DailyRouteScreen() {
  const { accessToken, startLogin } = usePreview();
  const [day, setDay] = useState(() => seoulDay(0));
  const [result, setResult] = useState<{
    day: string;
    token: string;
    refresh: number;
    points: RoutePoint[];
  }>();
  const [message, setMessage] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [origin, setOrigin] = useState<{ id: string; point: Coordinates }>();
  const [device, setDevice] = useState<{ token: string; point?: Coordinates; error?: string }>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loading =
    !!accessToken &&
    (result?.token !== accessToken || result.day !== day || result.refresh !== refresh);
  const points = accessToken === result?.token && result?.day === day ? result.points : noPoints;
  const today = day === seoulDay(0);
  const liveDay = today && (!!activeId || busy);
  const path = useMemo(
    () => (liveDay ? points.filter((p) => p.recordingId === activeId) : points),
    [activeId, liveDay, points],
  );
  const startPoint = path[0] ?? (liveDay && origin?.id === activeId ? origin?.point : undefined);
  const current = today && device?.token === accessToken ? device?.point : undefined;
  const deviceError = today && device?.token === accessToken ? device?.error : undefined;
  const useCampus = !!deviceError && !current;
  // 오늘은 휴대폰 위치를 중심으로 열고, 지난 날짜는 그날 저장된 경로를 보여 줍니다.
  const center = today ? (current ?? (useCampus ? campus : undefined)) : startPoint;
  const [confirmed, setConfirmed] = useState(false);
  const watch = useRef<LocationSubscription | null>(null);
  const recording = useRef<string | null>(null);
  const epoch = useRef(0);
  const lock = useRef(false);
  const localStop = useCallback(() => {
    epoch.current++;
    watch.current?.remove();
    watch.current = null;
    setActiveId(undefined);
    const id = recording.current;
    recording.current = null;
    return id;
  }, []);
  const stop = useCallback(async () => {
    const id = localStop();
    if (!id || !accessToken) return;
    try {
      await mapApi('/me/routes/recordings/' + id + '/stop', {
        token: accessToken,
        method: 'POST',
        body: {},
      });
      setMessage('기록을 중지했어요.');
    } catch {
      setMessage('기기의 기록을 중지했어요. 서버 중지 요청을 확인하지 못했어요.');
    }
    setRefresh((n) => n + 1);
  }, [accessToken, localStop]);
  useFocusEffect(
    useCallback(() => {
      if (!accessToken || !today || lock.current || recording.current) return;
      let closed = false;
      const version = epoch.current;
      setDevice(undefined);
      // 지도 미리보기에서는 기기 위치를 표시만 하고 경로 API에 전송하지 않습니다.
      void readDeviceLocation()
        .then((p) => {
          if (!closed && version === epoch.current)
            setDevice({
              token: accessToken,
              point: { lat: p.coords.latitude, lng: p.coords.longitude },
            });
        })
        .catch((e) => {
          if (!closed && version === epoch.current)
            setDevice({
              token: accessToken,
              error: e instanceof Error ? e.message : '현재 위치를 찾지 못했어요.',
            });
        });
      return () => {
        closed = true;
      };
    }, [accessToken, today]),
  );
  useFocusEffect(
    useCallback(() => {
      const sub = AppState.addEventListener('change', (s) => {
        if (s !== 'active') void stop();
      });
      return () => {
        sub.remove();
        void stop();
      };
    }, [stop]),
  );
  useEffect(() => {
    const abort = new AbortController();
    if (accessToken)
      mapApi<{ points: RoutePoint[] }>('/me/routes?date=' + day, {
        token: accessToken,
        signal: abort.signal,
      })
        .then((data) => {
          if (!abort.signal.aborted) {
            // 시연용으로 생성된 좌표는 개인 이동 경로의 출발점이나 경로선에 포함하지 않습니다.
            const points = data.points.filter((p) => p.source !== 'DEMO');
            setResult({ day, token: accessToken, refresh, points });
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setResult({ day, token: accessToken, refresh, points: [] });
            setMessage('경로를 불러오지 못했어요. 다시 조회해 주세요.');
          }
        });
    return () => abort.abort();
  }, [accessToken, day, refresh]);
  async function start() {
    if (!accessToken || lock.current || watch.current) return;
    lock.current = true;
    setBusy(true);
    setDay(seoulDay(0));
    setOrigin(undefined);
    setMessage('기기의 현재 위치에서 출발 지점을 확인하고 있어요.');
    const version = ++epoch.current;
    const token = accessToken;
    try {
      const initial = await readDeviceLocation().catch((error: unknown) => {
        if (version === epoch.current)
          setDevice({
            token,
            error: error instanceof Error ? error.message : '현재 위치를 찾지 못했어요.',
          });
        throw error;
      });
      if (version !== epoch.current) return;
      setDevice({ token, point: { lat: initial.coords.latitude, lng: initial.coords.longitude } });
      const status = await mapApi<Status>('/me/routes/status', { token });
      if (version !== epoch.current) return;
      const id = Crypto.randomUUID();
      const session = await mapApi<{ startedAt: string }>('/me/routes/recordings', {
        token,
        method: 'POST',
        body: {
          clientRecordingId: id,
          agreed: true,
          policyVersion: status.policyVersion,
          source: 'DEVICE',
        },
      });
      if (version !== epoch.current) {
        await mapApi('/me/routes/recordings/' + id + '/stop', { token, method: 'POST', body: {} });
        return;
      }
      recording.current = id;
      setActiveId(id);
      let lastTime = 0,
        flushing = false;
      const pending: Sample[] = [];
      const startedAt = Date.parse(session.startedAt);
      const receive = (loc: Pick<LocationObject, 'coords' | 'timestamp'>) => {
        if (version !== epoch.current || !Number.isFinite(loc.timestamp)) return;
        const { latitude: lat, longitude: lng, accuracy } = loc.coords;
        if (accuracy === null || !usableLocation(loc)) {
          setMessage('최근의 정확한 위치 신호를 기다리고 있어요.');
          return;
        }
        let recordedAt = loc.timestamp;
        if (recordedAt < startedAt) {
          // 정지한 기기는 새 요청에도 같은 센서 시각을 줄 수 있습니다. 동의 후 두 번
          // 확인한 동일한 최근 좌표만 출발점으로 삼고, 앱이 다시 확인한 시각에 기록합니다.
          const now = Date.now();
          if (
            lastTime !== 0 ||
            now - recordedAt > 15000 ||
            lat !== initial.coords.latitude ||
            lng !== initial.coords.longitude
          ) {
            if (!lastTime) setMessage('출발 지점의 새 위치 신호를 기다리고 있어요.');
            return;
          }
          recordedAt = Math.max(now, startedAt);
        }
        if (recordedAt - lastTime >= 15000 && pending.length < 100) {
          if (lastTime === 0) setOrigin({ id, point: { lat, lng } });
          setDevice({ token, point: { lat, lng } });
          lastTime = recordedAt;
          pending.push({
            clientPointId: Crypto.randomUUID(),
            recordedAt: new Date(recordedAt).toISOString(),
            lat,
            lng,
            accuracyM: Math.round(accuracy),
          });
        }
        if (flushing || !pending.length) return;
        flushing = true;
        const batch = pending.slice();
        void mapApi('/me/routes/recordings/' + id + '/points', {
          token,
          method: 'POST',
          body: { points: batch },
        })
          .then(() => {
            pending.splice(0, batch.length);
            if (version === epoch.current) {
              setMessage('최근 위치를 저장했어요.');
              setRefresh((n) => n + 1);
            }
          })
          .catch(() => {
            if (version === epoch.current)
              setMessage('저장하지 못했어요. 기록 중 다음 위치 신호에서 재시도해요.');
          })
          .finally(() => {
            flushing = false;
          });
      };
      // 동의 후 다시 정밀 측정한 위치부터 기록합니다. 일반 추적 신호가 출발점을 선점하지 않게 합니다.
      const first = await readDeviceLocation();
      if (version !== epoch.current) return;
      receive(first);
      const subscription = await watchDeviceLocation(receive, () => {
        if (version === epoch.current)
          setMessage('현재 위치 신호를 받지 못했어요. 기기의 위치 설정을 확인해 주세요.');
      });
      if (version !== epoch.current) {
        subscription.remove();
        return;
      }
      watch.current = subscription;
      setConfirmed(false);
    } catch (e) {
      if (version === epoch.current) {
        await stop();
        setMessage(e instanceof Error ? e.message : '기록을 시작하지 못했어요.');
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title="내 하루 이동 경로" onBack={() => router.replace('/nearby')} />
      {accessToken ? (
        <>
          <View style={{ flex: 1, minHeight: 185 }}>
            {center ? (
              <StreetMap
                key={day}
                center={center}
                position={current}
                startPoint={startPoint}
                path={path}
                fitPath={!today}
              />
            ) : (
              <View style={styles.panel}>
                <Text accessibilityLiveRegion="polite">
                  {today ? '현재 위치를 확인하고 있어요.' : '이 날짜에 표시할 경로가 없어요.'}
                </Text>
              </View>
            )}
          </View>
          <ScrollView
            style={{ flexGrow: 0, maxHeight: '52%' }}
            contentContainerStyle={styles.panel}
          >
            {useCampus && (
              <Text accessibilityLiveRegion="polite">
                기본 지도 · 한성대학교{!message && ` · ${deviceError}`}
              </Text>
            )}
            <Text style={typography.label}>
              {day} · {loading ? '조회 중' : path.length + '개 위치'}
            </Text>
            <View style={styles.days}>
              {['오늘', '어제', '그제'].map((label, i) => (
                <Text
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: day === seoulDay(i) }}
                  onPress={() => {
                    setDay(seoulDay(i));
                    setRefresh((n) => n + 1);
                  }}
                  style={[styles.day, day === seoulDay(i) && styles.selected]}
                >
                  {label}
                </Text>
              ))}
            </View>
            {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
            {!loading && !points.length && <Text>이 날짜에 보관 중인 이동 경로가 없어요.</Text>}
            <Text>
              동의 후 이 화면을 보는 동안 위치를 기록하고, 내 계정에 최대 48시간 보관해요. 화면을
              떠나면 기록이 중지돼요.
            </Text>
            {activeId ? (
              <ActionButton label="위치 기록 중지" onPress={() => void stop()} />
            ) : confirmed ? (
              <>
                <ActionButton
                  label="48시간 보관에 동의하고 시작"
                  loading={busy}
                  onPress={() => void start()}
                />
                <ActionButton label="취소" variant="outline" onPress={() => setConfirmed(false)} />
              </>
            ) : (
              <ActionButton label="위치 기록 시작" onPress={() => setConfirmed(true)} />
            )}
          </ScrollView>
        </>
      ) : (
        <View style={styles.panel}>
          <Text>로그인하면 내 계정의 이동 경로를 확인할 수 있어요.</Text>
          <ActionButton label="로그인" onPress={() => startLogin('routes')} />
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 10 },
  days: { flexDirection: 'row', gap: 12 },
  day: { padding: 8 },
  selected: { color: '#2167da', fontWeight: '700' },
});
