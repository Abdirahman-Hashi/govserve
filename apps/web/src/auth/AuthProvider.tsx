import { type SessionUser } from '@govserve/shared';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { getUser, refreshSession, subscribe } from './session-store';

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: SessionUser };

const AuthContext = createContext<AuthState>({ status: 'loading', user: null });

const toState = (user: SessionUser | null): AuthState =>
  user ? { status: 'authenticated', user } : { status: 'anonymous', user: null };

/** Restores the session from the refresh cookie on load (silent refresh). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    getUser() ? toState(getUser()) : { status: 'loading', user: null },
  );

  useEffect(() => {
    const unsubscribe = subscribe((user) => setState(toState(user)));
    if (!getUser()) {
      void refreshSession().then((ok) => {
        if (!ok) setState({ status: 'anonymous', user: null });
      });
    }
    return unsubscribe;
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
