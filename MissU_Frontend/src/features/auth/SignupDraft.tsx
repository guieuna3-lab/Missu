import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createSignupFlow, type SignupRequest } from './authApi';

// Carries the account form from 02.03 to the consent and verification steps.
// The account screen clears it when it unmounts, so the password stays in memory
// only while the sign-up flow is open.
type SignupDraftState = {
  draft: ReturnType<typeof createSignupFlow> | null;
  setDraft: (draft: SignupRequest | null) => void;
};
const SignupDraftContext = createContext<SignupDraftState | null>(null);

export function SignupDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setFlow] = useState<ReturnType<typeof createSignupFlow> | null>(null);
  const setDraft = useCallback((account: SignupRequest | null) => {
    setFlow(account ? createSignupFlow(account) : null);
  }, []);
  return (
    <SignupDraftContext.Provider value={{ draft, setDraft }}>
      {children}
    </SignupDraftContext.Provider>
  );
}

export function useSignupDraft() {
  const value = useContext(SignupDraftContext);
  if (!value) throw new Error('SignupDraftProvider is required');
  return value;
}
