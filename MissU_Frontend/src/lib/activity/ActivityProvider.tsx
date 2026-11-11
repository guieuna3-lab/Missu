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
import { api, ApiError } from '@/lib/backend';
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

// In-memory mock of the member's activity (reports, registered items, ownership requests).
// It loads when a member session starts and is dropped when the session ends. Every action
// waits like a request so the screens exercise their submitting states; see mockRequest.ts.
type ActivityValue = ActivityState & {
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
  confirmAppointment: (id: string, by: Party) => Promise<void>;
  markHanded: (id: string) => Promise<void>;
  confirmReceived: (id: string) => Promise<void>;
  reportSuspicious: (id: string, report: Omit<SuspiciousReport, 'createdAt'>) => Promise<void>;
};

const ActivityContext = createContext<ActivityValue | null>(null);

const LOAD_DELAY_MS = 300;

type Loaded = { session: number; state: ActivityState };

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { profile, sessionId, activityPreset, accessToken } = usePreview();
  const signedIn = !!profile;
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
      const headers = { Authorization: 'Bearer ' + accessToken };
      void (async () => {
        const history = await api<{ data: { id: string; createdAt: string }[] }>(
          '/me/history?type=MY_ITEMS',
          { headers },
        );
        const foundItems = await Promise.all(
          history.data.map(async (row) => {
            const { data } = await api<{ data: ServerItem & { privateFeatures?: string } }>(
              '/items/' + row.id + '/manage',
              { headers },
            );
            return {
              id: row.id,
              name: data.name,
              createdAt: row.createdAt,
              category: data.category === 'WALLET_BAG' ? ('BAG' as const) : data.category,
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
        if (active)
          setLoaded((current) =>
            current?.session === sessionId
              ? current
              : { session: sessionId, state: { ...emptyActivity, foundItems } },
          );
      })().catch(() => {
        if (active)
          setLoaded((current) =>
            current?.session === sessionId ? current : { session: sessionId, state: emptyActivity },
          );
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
        run((current) => {
          const { state: next, report } = addLostReport(current, input, clock('lost'));
          return { state: next, result: report };
        }),
      updateLostReport: (id: string, patch: Partial<LostReportInput>) =>
        apply((current) => updateLostReport(current, id, patch)),
      deleteLostReport: (id: string) => apply((current) => deleteLostReport(current, id)),
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
          foundAt: input.foundAt,
          foundLocation: { label: input.place.detail, lat: input.place.lat, lng: input.place.lng },
          photoIds: input.photoIds,
          storagePlace: input.storage,
          pickupGuide: input.pickupGuide,
          privateFeatures: input.privateFeature,
        };
        const fingerprint = JSON.stringify(payload);
        if (attempt.current?.form !== fingerprint)
          attempt.current = { form: fingerprint, key: crypto.randomUUID() };
        const result = await api<{ data: { id: string } }>('/items', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
            'Idempotency-Key': attempt.current.key,
          },
          body: fingerprint,
        });
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
        apply((current) => updateFoundItem(current, id, patch)),
      sendRequest: (input: RequestInput) =>
        run((current) => {
          const { state: next, request } = addRequest(current, input, clock('request'));
          return { state: next, result: request };
        }),
      cancelRequest: (id: string) => apply((current) => cancelRequest(current, id)),
      approveRequest: (id: string) => apply((current) => approveRequest(current, id)),
      rejectRequest: (id: string) => apply((current) => rejectRequest(current, id)),
      sendMessage: (id: string, by: Party, text: string) =>
        apply((current) => sendMessage(current, id, by, text, clock('message'))),
      proposeAppointment: (id: string, by: Party, appointment: Appointment) =>
        apply((current) => proposeAppointment(current, id, by, appointment)),
      confirmAppointment: (id: string, by: Party) =>
        apply((current) => confirmAppointment(current, id, by)),
      markHanded: (id: string) => apply((current) => markHanded(current, id, clock('handed'))),
      confirmReceived: (id: string) =>
        apply((current) => confirmReceived(current, id, clock('received'))),
      reportSuspicious: (id: string, report: Omit<SuspiciousReport, 'createdAt'>) =>
        apply((current) =>
          reportSuspicious(current, id, { ...report, createdAt: new Date().toISOString() }),
        ),
    }),
    [apply, clock, run, accessToken, sessionId],
  );

  const value = useMemo(() => ({ ...state, status, ...actions }), [state, status, actions]);
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('ActivityProvider is required');
  return value;
}
