import {
  backgroundRoute,
  reconcileRouteAccount,
  routeCommand,
} from '@/features/nearby/backgroundRoute';
import { logout, type AuthSession } from '@/features/auth/authApi';
import { clearSavedSession, restoreSession, saveSession } from '@/features/auth/persistentSession';
import { disconnectPush, nativePush, syncPush } from '@/features/notifications/push';
import { router, type Href } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { apiBase } from '../backend';
import { previewProfile, type Profile } from './fixtures';

// 개발용 미리보기는 운영 API를 연결하지 않은 경우에만 활성화합니다.
const previewMode = __DEV__ && !apiBase ? process.env.EXPO_PUBLIC_MISSU_PREVIEW : undefined;
export const isPreview = previewMode === 'guest' || previewMode === 'member';

/** Where the login started (Figma `loginReturnTo`). */
export type LoginOrigin =
  'home' | 'mine' | 'report' | 'search' | 'routes' | 'notifications' | { itemId: string };

function getSearchReturnTo(origin: LoginOrigin | null): Href | undefined {
  if (origin === 'notifications') return '/notifications';
  if (origin === 'routes') return '/daily-route';
  if (origin === 'search') return '/search';
  if (origin && typeof origin === 'object') {
    return { pathname: '/items/[id]', params: { id: origin.itemId } };
  }
  return undefined;
}

/** Which mock activity a member session starts with: Figma examples, or nothing (가입 직후). */
export type ActivityPreset = 'sample' | 'empty';

type PreviewState = {
  restoringSession: boolean;
  sessionNotice: string;
  retrySession: () => void;
  profile: Profile | null;
  /** Changes whenever a member session starts or ends, so session-scoped data can reset. */
  sessionId: number;
  accessToken: string | null;
  /** The server no longer accepts the session (Figma 01.04-S). Nothing sets it in the mock yet. */
  sessionExpired: boolean;
  markSessionExpired: () => void;
  activityPreset: ActivityPreset;
  updateProfile: (profile: Pick<Profile, 'name' | 'email'>) => void;
  /** Records the number confirmed on 07.03; clears it from 계정 관리 (02-A.06-U). */
  verifyPhone: (phone: string) => void;
  clearPhone: () => void;
  exitMemberPreview: () => void;
  startLogin: (origin: LoginOrigin) => void;
  cancelLogin: () => void;
  /** Switches to the member state with a mock auth result. */
  signIn: (session: AuthSession | Profile, token?: string) => void;
  completeSignup: (session: AuthSession | Profile) => void;
  /** Clears the login/sign-up screens from history and opens the destination. */
  continueAfterLogin: (destination?: '/search') => void;
};
const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(
    previewMode === 'member' ? { ...previewProfile } : null,
  );
  const [loginOrigin, setLoginOrigin] = useState<LoginOrigin | null>(null);
  const [activityPreset, setActivityPreset] = useState<ActivityPreset>('sample');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(!isPreview && !!apiBase);
  const [sessionNotice, setSessionNotice] = useState('');
  const [sessionId, setSessionId] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const sessionGeneration = useRef(0);
  const restoring = useRef(false);
  const lastRestore = useRef(0);
  const saveFailed = useRef(false);
  const mounted = useRef(true);
  const currentProfile = useRef(profile);
  useEffect(() => {
    currentProfile.current = profile;
  }, [profile]);
  const restore = useCallback(async () => {
    if (restoring.current || isPreview || !apiBase) return;
    restoring.current = true;
    const run = sessionGeneration.current;
    setRestoringSession(true);
    try {
      const session = await restoreSession();
      if (!mounted.current || run !== sessionGeneration.current) return;
      if (session && currentProfile.current?.email !== session.profile.email)
        setSessionId((n) => n + 1);
      setAccessToken(session?.accessToken ?? null);
      setProfile(session?.profile ?? null);
      if (session) {
        setActivityPreset('empty');
        setSessionExpired(false);
      }
      setSessionNotice('');
      lastRestore.current = Date.now();
    } catch {
      if (mounted.current && run === sessionGeneration.current)
        setSessionNotice('저장된 로그인을 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      restoring.current = false;
      if (mounted.current && run === sessionGeneration.current) setRestoringSession(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => {
      void restore();
    }, 0);
    const refresh = () => {
      if (AppState.currentState === 'active' && Date.now() - lastRestore.current >= 15 * 60000)
        void restore();
    };
    const timer = setInterval(refresh, 60000);
    const listener = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(timer);
      listener.remove();
    };
  }, [restore]);
  useEffect(() => {
    if (!nativePush) return;
    const open = () => router.push('/notifications');
    window.addEventListener('missu-open-notifications', open);
    if (accessToken && profile) void syncPush(profile.email, accessToken).catch(() => undefined);
    return () => window.removeEventListener('missu-open-notifications', open);
  }, [accessToken, profile]);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !backgroundRoute || restoringSession || sessionNotice) return;
    // 위치 이벤트에 의해 백그라운드에서 시작한 경우에는 로그인 화면으로 간주하지 않습니다.
    if (AppState.currentState === 'active') reconcileRouteAccount(accessToken);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcileRouteAccount(accessToken);
    });
    return () => listener.remove();
  }, [accessToken, restoringSession, sessionNotice]);
  const nextSession = () => {
    sessionGeneration.current++;
    setRestoringSession(false);
    lastRestore.current = Date.now();
    setSessionId((current) => current + 1);
    setSessionExpired(false);
  };
  function remember(session: AuthSession) {
    const run = sessionGeneration.current;
    void saveSession(session).then(
      () => {
        if (mounted.current && run === sessionGeneration.current) {
          saveFailed.current = false;
          setSessionNotice('');
        }
      },
      () => {
        if (mounted.current && run === sessionGeneration.current) {
          saveFailed.current = true;
          setSessionNotice(
            '로그인은 됐지만 로그인 유지 설정을 저장하지 못했어요. 다시 시도해 주세요.',
          );
        }
      },
    );
  }
  return (
    <PreviewContext.Provider
      value={{
        profile,
        restoringSession,
        sessionNotice,
        retrySession: () => {
          if (saveFailed.current && profile && accessToken) remember({ profile, accessToken });
          else void restore();
        },
        sessionId,
        accessToken,
        sessionExpired,
        markSessionExpired: () => {
          setSessionExpired(true);
          void restore();
        },
        activityPreset,
        updateProfile: (next) =>
          setProfile((current) => (current ? { ...current, ...next } : current)),
        verifyPhone: (phone) =>
          setProfile((current) => (current ? { ...current, phone, phoneVerified: true } : current)),
        clearPhone: () =>
          setProfile((current) =>
            current ? { ...current, phone: undefined, phoneVerified: false } : current,
          ),
        exitMemberPreview: () => {
          nextSession();
          setSessionNotice('');
          void clearSavedSession().catch(() => undefined);
          if (Platform.OS === 'ios' && backgroundRoute) reconcileRouteAccount(null);
          else if (backgroundRoute && accessToken)
            void routeCommand('stop', { token: accessToken }).catch(() => undefined);
          if (accessToken)
            void disconnectPush(accessToken)
              .catch(() => undefined)
              .then(() => logout(accessToken))
              .catch(() => undefined);
          setAccessToken(null);
          setProfile(null);
        },
        startLogin: (origin) => {
          setLoginOrigin(origin);
          router.push('/login');
        },
        cancelLogin: () => {
          setLoginOrigin(null);
          router.dismissTo(getSearchReturnTo(loginOrigin) ?? '/home');
        },
        signIn: (next, token) => {
          nextSession();
          setActivityPreset('empty');
          setAccessToken('accessToken' in next ? next.accessToken : (token ?? null));
          setProfile('profile' in next ? next.profile : next);
          if ('accessToken' in next) remember(next);
        },
        completeSignup: (next) => {
          // A new account has no activity yet (Figma 01.05-E).
          nextSession();
          setActivityPreset('empty');
          setAccessToken('accessToken' in next ? next.accessToken : null);
          setProfile('profile' in next ? next.profile : next);
          if ('accessToken' in next) remember(next);
          if (getSearchReturnTo(loginOrigin)) {
            router.dismissTo('/login');
          } else if (router.canDismiss()) {
            router.dismissAll();
          }
          router.replace('/signup/complete');
        },
        continueAfterLogin: (destination) => {
          setLoginOrigin(null);
          const searchReturnTo = destination ?? getSearchReturnTo(loginOrigin);
          if (searchReturnTo) {
            router.dismissTo(searchReturnTo);
            return;
          }
          if (router.canDismiss()) router.dismissAll();
          // Keep the existing 01/02 destinations for report and history.
          router.replace(loginOrigin === 'report' ? '/report' : '/history');
        },
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error('PreviewProvider is required');
  return value;
}
