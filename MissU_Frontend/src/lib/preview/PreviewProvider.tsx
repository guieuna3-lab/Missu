import { androidRoute, routeCommand } from '@/features/nearby/androidRoute';
import { logout, type AuthSession } from '@/features/auth/authApi';
import { router, type Href } from 'expo-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { apiBase } from '../backend';
import { previewProfile, type Profile } from './fixtures';

// 개발용 미리보기는 운영 API를 연결하지 않은 경우에만 활성화합니다.
const previewMode = __DEV__ && !apiBase ? process.env.EXPO_PUBLIC_MISSU_PREVIEW : undefined;
export const isPreview = previewMode === 'guest' || previewMode === 'member';

/** Where the login started (Figma `loginReturnTo`). */
export type LoginOrigin = 'home' | 'mine' | 'report' | 'search' | 'routes' | { itemId: string };

function getSearchReturnTo(origin: LoginOrigin | null): Href | undefined {
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
  const [sessionId, setSessionId] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const nextSession = () => {
    setSessionId((current) => current + 1);
    setSessionExpired(false);
  };
  return (
    <PreviewContext.Provider
      value={{
        profile,
        sessionId,
        accessToken,
        sessionExpired,
        markSessionExpired: () => setSessionExpired(true),
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
          if (androidRoute && accessToken) void routeCommand('stop', { token: accessToken }).catch(() => undefined);
          if (accessToken) void logout(accessToken).catch(() => undefined);
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
        },
        completeSignup: (next) => {
          // A new account has no activity yet (Figma 01.05-E).
          nextSession();
          setActivityPreset('empty');
          setAccessToken('accessToken' in next ? next.accessToken : null);
          setProfile('profile' in next ? next.profile : next);
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
