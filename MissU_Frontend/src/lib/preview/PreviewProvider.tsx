import { router } from 'expo-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { previewProfile, type Profile } from './fixtures';

// Opt-in, development-only visual fixtures and the mock sign-in state.
// Never establishes a real session or stores credentials.
const previewMode = __DEV__ ? process.env.EXPO_PUBLIC_MISSU_PREVIEW : undefined;
export const isPreview = previewMode === 'guest' || previewMode === 'member';

/** Where the login started (Figma `loginReturnTo`). */
export type LoginOrigin = 'home' | 'mine' | 'report';

type PreviewState = {
  profile: Profile | null;
  updateProfile: (profile: Profile) => void;
  exitMemberPreview: () => void;
  startLogin: (origin: LoginOrigin) => void;
  /** Switches to the member state with a mock auth result. */
  signIn: (profile: Profile) => void;
  /** Clears the login/sign-up screens from history and opens the destination. */
  continueAfterLogin: () => void;
};
const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(
    previewMode === 'member' ? { ...previewProfile } : null,
  );
  const [loginOrigin, setLoginOrigin] = useState<LoginOrigin | null>(null);
  return (
    <PreviewContext.Provider
      value={{
        profile,
        updateProfile: (next) => {
          if (profile) setProfile(next);
        },
        exitMemberPreview: () => setProfile(null),
        startLogin: (origin) => {
          setLoginOrigin(origin);
          router.push('/login');
        },
        signIn: (next) => setProfile(next),
        continueAfterLogin: () => {
          setLoginOrigin(null);
          if (router.canDismiss()) router.dismissAll();
          // Figma: only a login started from 신고 returns to 04.01; every other origin opens 01.05.
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
