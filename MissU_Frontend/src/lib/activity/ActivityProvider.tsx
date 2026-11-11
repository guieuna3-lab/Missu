import { randomUUID } from 'expo-crypto';
import { lostReportClient } from './lostReports';
import { usePathname } from 'expo-router';
import { createClaimClient } from './claimClient';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, apiBase } from '@/lib/backend';
import type { ServerItem } from '@/lib/items';
import { respond } from '@/lib/mockRequest';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { emptyActivity, sampleActivity } from './fixtures';
import {
  addFoundItem,
  addLostReport,
  addRequest,
  approveRequest,
  cancelRequest,
  confirmAppointment,
  confirmReceived,
  deleteLostReport,
  markHanded,
  proposeAppointment,
  rejectRequest,
  reportSuspicious,
  sendMessage,
  updateFoundItem,
  updateLostReport,
  type FoundItemInput,
  type LostReportInput,
  type RequestInput,
} from './transitions';
import type {
  ActivityState,
  Appointment,
  FoundItem,
  LostReport,
  OwnershipRequest,
  Party,
  SuspiciousReport,
} from './types';

// 로그인한 회원의 반환 내역은 서버에서 읽고, 개발용 예시 세션은 기존 데이터를 사용합니다.
type ActivityValue = ActivityState & {
  reportsError?: string;
  retryReports: () => void;
  /** 'loading' while the activity is being fetched after sign-in (Figma 01.05-L). */
  status: 'loading' | 'ready';
  createLostReport: (input: LostReportInput) => Promise<LostReport>;
  updateLostReport: (id: string, patch: Partial<LostReportInput>) => Promise<void>;
  deleteLostReport: (id: string) => Promise<void>;
  registerFoundItem: (input: FoundItemInput) => Promise<FoundItem>;
  updateFoundItem: (id: string, patch: Partial<FoundItemInput>) => Promise<void>;
  sendRequest: (input: RequestInput) => Promise<OwnershipRequest>;
  cancelRequest: (id: string) => Promise<void>;
  approveRequest: (id: string) => Promise<void>;
  rejectRequest: (id: string) => Promise<void>;
  sendMessage: (id: string, by: Party, text: string) => Promise<void>;
  proposeAppointment: (id: string, by: Party, appointment: Appointment) => Promise<void>;
  confirmAppointment: (id: string, by: Party, proposalId?: string) => Promise<void>;
  markHanded: (id: string) => Promise<void>;
  confirmReceived: (id: string) => Promise<void>;
  reportSuspicious: (
    id: string,
    report: Omit<SuspiciousReport, 'createdAt'>,
  ) => Promise<string | void>;
};

const ActivityContext = createContext<ActivityValue | null>(null);

const LOAD_DELAY_MS = 300;

type Loaded = { session: number; state: ActivityState };

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { profile, sessionId, activityPreset, accessToken } = usePreview();
  const signedIn = !!profile;
  const path = usePathname();
  const claimClient = useMemo(
    () => (accessToken ? createClaimClient(accessToken) : null),
    [accessToken],
  );
  const reportsClient = useMemo(
    () => (accessToken ? lostReportClient(accessToken) : null),
    [accessToken],
  );
  const [reportsLoad, setReportsLoad] = useState<{
    client: typeof reportsClient;
    error?: string;
  }>();
  const [reloadReports, setReloadReports] = useState(0);
  const reportsRevision = useRef(0);
  const activeClient = useRef(claimClient);
  const revision = useRef(0);
  useEffect(() => {
    activeClient.current = claimClient;
    return () => {
      activeClient.current = null;
    };
  }, [claimClient]);
  const claimId = path.match(/\/requests\/([^/]+)/)?.[1];
  const watching = /^\/(history|my-items|requests)(\/|$)/.test(path);
  // Activity is keyed by the session that loaded it; a new session starts empty and loading.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const ready = signedIn && loaded?.session === sessionId;
  const state = ready ? loaded.state : emptyActivity;
  const status: ActivityValue['status'] = signedIn && !ready ? 'loading' : 'ready';
  // Actions read the latest state here, so two quick taps cannot work on stale data.
  const stateRef = useRef(state);
  const counter = useRef(0);
  const attempt = useRef<{ form: string; key: string } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!signedIn) return;
    if (accessToken) {
      let active = true;
      const initialItems = new Map(stateRef.current.foundItems.map((item) => [item.id, item]));
      const headers = { Authorization: 'Bearer ' + accessToken };
      void (async () => {
        const rows: { id: string; createdAt: string }[] = [];
        let cursor: string | null = null;
        do {
          const history: { data: typeof rows; meta: { nextCursor: string | null } } = await api(
            '/me/history?type=MY_ITEMS&limit=50' +
              (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
            { headers },
          );
          rows.push(...history.data);
          cursor = history.meta.nextCursor;
        } while (cursor);
        const foundItems = await Promise.all(
          rows.map(async (row) => {
            const { data } = await api<{
              data: ServerItem & { privateFeatures?: string; appCategory?: FoundItem['category'] };
            }>('/items/' + row.id + '/manage', { headers });
            return {
              id: row.id,
              name: data.name,
              createdAt: row.createdAt,
              category:
                data.appCategory ??
                (data.category === 'WALLET_BAG' ? ('BAG' as const) : data.category),
              attachments: data.photos.map((photo) => ({
                id: photo.id,
                preview: new URL(photo.url, apiBase).href,
              })),
              foundAt: data.foundAt,
              place: {
                name: data.foundLocation.label,
                detail: data.foundLocation.label,
                lat: data.foundLocation.lat,
                lng: data.foundLocation.lng,
              },
              photos: data.photos.length,
              storage: data.storagePlace,
              pickupGuide: data.pickupGuide ?? '',
              privateFeature: data.privateFeatures ?? '',
            };
          }),
        );
        if (active) {
          // 조회 도중 등록하거나 수정한 물품은 서버의 이전 응답으로 덮지 않습니다.
          const updated = stateRef.current.foundItems.filter(
            (item) => initialItems.get(item.id) !== item,
          );
          const ids = new Set(updated.map((item) => item.id));
          const next = {
            ...stateRef.current,
            foundItems: [...updated, ...foundItems.filter((item) => !ids.has(item.id))],
          };
          stateRef.current = next;
          setLoaded({ session: sessionId, state: next });
        }
      })().catch(() => {
        /* 반환 요청 동기화는 물품 목록과 독립적으로 진행됩니다. */
      });
      return () => {
        active = false;
      };
    }
    const timer = setTimeout(() => {
      setLoaded({
        session: sessionId,
        state: activityPreset === 'sample' ? sampleActivity : emptyActivity,
      });
    }, LOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [signedIn, sessionId, activityPreset, accessToken]);

  useEffect(() => {
    if (!reportsClient) return;
    let active = true;
    const version = reportsRevision.current;
    void reportsClient
      .list()
      .then((lostReports) => {
        if (!active) return;
        // 조회와 저장이 겹친 경우 최신 목록을 다시 읽어 삭제한 신고가 되살아나지 않게 합니다.
        if (version !== reportsRevision.current) {
          setReloadReports((n) => n + 1);
          return;
        }
        const next = { ...stateRef.current, lostReports };
        stateRef.current = next;
        setLoaded({ session: sessionId, state: next });
        setReportsLoad({ client: reportsClient });
      })
      .catch(() => {
        if (active)
          setReportsLoad({ client: reportsClient, error: '분실 신고 내역을 불러오지 못했어요.' });
      });
    return () => {
      active = false;
    };
  }, [reportsClient, sessionId, reloadReports]);
  const changeReport = useCallback(
    (id: string, row?: LostReport) => {
      if (!claimClient || activeClient.current !== claimClient)
        throw new ApiError(401, '다시 로그인해 주세요.');
      reportsRevision.current++;
      const current = stateRef.current,
        rest = current.lostReports.filter((r) => r.id !== id);
      const next = {
        ...current,
        lostReports: row
          ? [row, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : rest,
      };
      stateRef.current = next;
      setLoaded({ session: sessionId, state: next });
    },
    [claimClient, sessionId],
  );
  // 메시지는 현재 열어 둔 요청에서만 읽고 새 메시지부터 이어 받습니다.
  useEffect(() => {
    if (!claimClient) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      const version = revision.current;
      try {
        const requests = await claimClient!.list();
        const opened = requests.find((r) => r.id === claimId);
        if (opened && ['approved', 'scheduled', 'handed', 'completed'].includes(opened.status)) {
          opened.messages = await claimClient!.messages(opened.id);
        }
        if (!active || activeClient.current !== claimClient || version !== revision.current) return;
        const current = stateRef.current;
        for (const request of requests) {
          if (request !== opened)
            request.messages = current.requests.find((r) => r.id === request.id)?.messages ?? [];
        }
        const next = { ...current, requests };
        stateRef.current = next;
        setLoaded({ session: sessionId, state: next });
      } catch {
        // 일시적인 네트워크 오류가 이미 읽은 대화나 내역을 지우지 않도록 합니다.
      } finally {
        if (active && watching) timer = setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [claimClient, sessionId, claimId, watching]);

  const changeClaim = useCallback(
    async (path: string, body: object, id?: string) => {
      if (!claimClient) throw new ApiError(401, '로그인이 필요합니다.');
      const updated = await claimClient.mutate(path, body, id);
      if (activeClient.current !== claimClient) throw new ApiError(401, '다시 로그인해 주세요.');
      revision.current++;
      const current = stateRef.current;
      const existing = current.requests.find((row) => row.id === updated.id);
      updated.messages = [
        ...(existing?.messages ?? []),
        ...updated.messages.filter((m) => !existing?.messages.some((prior) => prior.id === m.id)),
      ];
      const rest = current.requests.filter((row) => row.id !== updated.id);
      const next = {
        ...current,
        requests:
          updated.closedReason === '요청자 취소'
            ? rest
            : [updated, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
      stateRef.current = next;
      setLoaded({ session: sessionId, state: next });
      return updated;
    },
    [claimClient, sessionId],
  );

  // Ids must not collide with the fixture ids (such as lost-1), so they carry a time part.
  const clock = useCallback((prefix: string) => {
    counter.current += 1;
    return {
      id: `${prefix}-${Date.now().toString(36)}-${counter.current}`,
      now: new Date().toISOString(),
    };
  }, []);

  const run = useCallback(
    async <T,>(transition: (current: ActivityState) => { state: ActivityState; result: T }) => {
      await respond(undefined);
      const { state: next, result } = transition(stateRef.current);
      stateRef.current = next;
      setLoaded({ session: sessionId, state: next });
      return result;
    },
    [sessionId],
  );
  const apply = useCallback(
    (transition: (current: ActivityState) => ActivityState) =>
      run((current) => ({ state: transition(current), result: undefined })),
    [run],
  );

  const actions = useMemo(
    () => ({
      createLostReport: (input: LostReportInput) =>
        reportsClient
          ? reportsClient.save(input).then((row) => {
              changeReport(row.id, row);
              return row;
            })
          : run((current) => {
              const { state: next, report } = addLostReport(current, input, clock('lost'));
              return { state: next, result: report };
            }),
      updateLostReport: (id: string, patch: Partial<LostReportInput>) =>
        reportsClient
          ? (async () => {
              const old = stateRef.current.lostReports.find((r) => r.id === id);
              if (!old) throw new ApiError(404, '신고를 찾을 수 없어요.');
              changeReport(id, await reportsClient.save({ ...old, ...patch }, id));
            })()
          : apply((current) => updateLostReport(current, id, patch)),
      deleteLostReport: (id: string) =>
        reportsClient
          ? reportsClient.remove(id).then(() => changeReport(id))
          : apply((current) => deleteLostReport(current, id)),
      registerFoundItem: async (input: FoundItemInput) => {
        if (!accessToken) throw new ApiError(401, '로그인이 필요합니다.');
        if (!input.photoIds?.length || input.place.lat == null || input.place.lng == null)
          throw new ApiError(400, '물품 사진과 습득 위치를 다시 선택해 주세요.');
        const category =
          input.category === 'WALLET' || input.category === 'BAG'
            ? 'WALLET_BAG'
            : input.category === 'ELECTRONICS'
              ? 'ELECTRONICS'
              : 'OTHER';
        const payload = {
          name: input.name,
          category,
          appCategory: input.category,
          foundAt: input.foundAt,
          foundLocation: { label: input.place.detail, lat: input.place.lat, lng: input.place.lng },
          photoIds: input.photoIds,
          storagePlace: input.storage,
          pickupGuide: input.pickupGuide,
          privateFeatures: input.privateFeature,
        };
        const fingerprint = JSON.stringify(payload);
        if (attempt.current?.form !== fingerprint)
          attempt.current = { form: fingerprint, key: randomUUID() };
        const result = await api<{ data: { id: string } }>('/items', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
            'Idempotency-Key': attempt.current.key,
          },
          body: fingerprint,
        });
        attempt.current = null;
        if (activeClient.current !== claimClient) throw new ApiError(401, '다시 로그인해 주세요.');
        const { state: next, item } = addFoundItem(stateRef.current, input, {
          id: result.data.id,
          now: new Date().toISOString(),
        });
        next.foundItems = next.foundItems.filter(
          (v, i, arr) => arr.findIndex((x) => x.id === v.id) === i,
        );
        stateRef.current = next;
        setLoaded({ session: sessionId, state: next });
        return item;
      },
      updateFoundItem: (id: string, patch: Partial<FoundItemInput>) =>
        accessToken
          ? (async () => {
              const prior = stateRef.current.foundItems.find((r) => r.id === id);
              if (!prior) throw new ApiError(404, '물품을 찾을 수 없어요.');
              const item = { ...prior, ...patch };
              const photoIds = patch.photoIds ?? item.attachments?.map((p) => p.id);
              if (!photoIds?.length || item.place.lat == null || item.place.lng == null)
                throw new ApiError(400, '사진과 위치를 확인해 주세요.');
              const category =
                item.category === 'WALLET' || item.category === 'BAG'
                  ? 'WALLET_BAG'
                  : item.category === 'ELECTRONICS'
                    ? 'ELECTRONICS'
                    : 'OTHER';
              const { data } = await api<{ data: ServerItem }>('/items/' + id, {
                method: 'PUT',
                headers: {
                  Authorization: 'Bearer ' + accessToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name: item.name,
                  category,
                  appCategory: item.category,
                  foundAt: item.foundAt,
                  foundLocation: {
                    label: item.place.detail,
                    lat: item.place.lat,
                    lng: item.place.lng,
                  },
                  photoIds,
                  storagePlace: item.storage,
                  pickupGuide: item.pickupGuide,
                  privateFeatures: item.privateFeature,
                }),
              });
              if (activeClient.current !== claimClient)
                throw new ApiError(401, '다시 로그인해 주세요.');
              const next = updateFoundItem(stateRef.current, id, {
                ...patch,
                photos: data.photos.length,
                attachments: data.photos.map((p) => ({
                  id: p.id,
                  preview: new URL(p.url, apiBase).href,
                })),
              });
              stateRef.current = next;
              setLoaded({ session: sessionId, state: next });
            })()
          : apply((current) => updateFoundItem(current, id, patch)),
      sendRequest: (input: RequestInput) =>
        claimClient
          ? changeClaim('/items/' + input.itemId + '/claims', {
              features: input.feature,
              lostInfo: input.lostInfo,
            })
          : run((current) => {
              const { state: next, request } = addRequest(current, input, clock('request'));
              return { state: next, result: request };
            }),
      cancelRequest: (id: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/cancel', {}, id).then(() => undefined)
          : apply((current) => cancelRequest(current, id)),
      approveRequest: (id: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/decision', { decision: 'APPROVE' }, id).then(
              () => undefined,
            )
          : apply((current) => approveRequest(current, id)),
      rejectRequest: (id: string) =>
        claimClient
          ? changeClaim(
              '/claims/' + id + '/decision',
              { decision: 'REJECT', reason: '정보 불일치' },
              id,
            ).then(() => undefined)
          : apply((current) => rejectRequest(current, id)),
      sendMessage: (id: string, by: Party, text: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/messages', { body: text }, id).then(() => undefined)
          : apply((current) => sendMessage(current, id, by, text, clock('message'))),
      proposeAppointment: (id: string, by: Party, appointment: Appointment) =>
        claimClient
          ? changeClaim('/claims/' + id + '/appointment', appointment, id).then(() => undefined)
          : apply((current) => proposeAppointment(current, id, by, appointment)),
      confirmAppointment: (id: string, by: Party, proposalId?: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/appointment/confirm', { proposalId }, id).then(
              () => undefined,
            )
          : apply((current) => confirmAppointment(current, id, by)),
      markHanded: (id: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/handover', {}, id).then(() => undefined)
          : apply((current) => markHanded(current, id, clock('handed'))),
      confirmReceived: (id: string) =>
        claimClient
          ? changeClaim('/claims/' + id + '/receipt', {}, id).then(() => undefined)
          : apply((current) => confirmReceived(current, id, clock('received'))),
      reportSuspicious: (id: string, report: Omit<SuspiciousReport, 'createdAt'>) =>
        claimClient
          ? claimClient.report(id, report)
          : apply((current) =>
              reportSuspicious(current, id, { ...report, createdAt: new Date().toISOString() }),
            ),
    }),
    [
      apply,
      clock,
      run,
      accessToken,
      sessionId,
      claimClient,
      changeClaim,
      reportsClient,
      changeReport,
    ],
  );

  const value = useMemo(
    () => ({
      ...state,
      status:
        reportsClient && reportsLoad?.client !== reportsClient ? ('loading' as const) : status,
      reportsError: reportsLoad?.client === reportsClient ? reportsLoad?.error : undefined,
      retryReports: () => setReloadReports((n) => n + 1),
      ...actions,
    }),
    [state, status, actions, reportsClient, reportsLoad],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('ActivityProvider is required');
  return value;
}
