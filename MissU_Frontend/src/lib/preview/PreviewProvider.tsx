import { router, type Href } from 'expo-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { previewProfile, type Profile } from './fixtures';
import { api, apiBase } from '../backend';

// Opt-in, development-only visual fixtures and the mock sign-in state.
// Never establishes a real session or stores credentials.
const previewMode = __DEV__ && !apiBase ? process.env.EXPO_PUBLIC_MISSU_PREVIEW : undefined;
export const isPreview = previewMode === 'guest' || previewMode === 'member';

/** Where the login started (Figma `loginReturnTo`). */
export type LoginOrigin = 'home' | 'mine' | 'report' | 'search' | { itemId: string };

function getSearchReturnTo(origin: LoginOrigin | null): Href | undefined {
  if (origin === 'search') return '/search';
  if (origin && typeof origin === 'object') {
    return { pathname: '/items/[id]', params: { id: origin.itemId } };
  }
  return undefined;
}

type PreviewState = {
  profile: Profile | null;
  updateProfile: (profile: Profile) => void;
  exitMemberPreview: () => void;
  startLogin: (origin: LoginOrigin) => void;
  cancelLogin: () => void;
  /** Switches to the member state with a mock auth result. */
  signIn: (profile: Profile, token?: string) => void;
  accessToken: string | null;
  completeSignup: (profile: Profile) => void;
  /** Clears the login/sign-up screens from history and opens the destination. */
  continueAfterLogin: (destination?: '/search') => void;
};
const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(
    previewMode === 'member' ? { ...previewProfile } : null,
  );
  const [loginOrigin, setLoginOrigin] = useState<LoginOrigin | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  return (
    <PreviewContext.Provider
      value={{
        profile,
        accessToken,
        updateProfile: (next) => {
          if (profile) setProfile(next);
        },
        exitMemberPreview: () => {
          if (accessToken) {
            void api('/auth/logout', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + accessToken },
            }).catch(() => {});
          }
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
          setAccessToken(token ?? null);
          setProfile(next);
        },
        completeSignup: (next) => {
          setProfile(next);
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
          router.replace(
            loginOrigin === 'report' || (apiBase && loginOrigin === 'home')
              ? '/report'
              : '/history',
          );
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
