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
import {
  getGoogleClientId,
  initializeGoogleId,
  isAdminEmail,
  loadStoredUser,
  signOutGoogle,
  storeUser,
  userFromIdToken,
} from './google';
import { LoginModal } from './login-modal';
import type { AuthUser, GoogleCredentialResponse } from './types';
import { setAuthTokenProvider } from '../api/school-memories';

type AuthContextValue = {
  user: AuthUser | null;
  isAdmin: boolean;
  ready: boolean;
  configured: boolean;
  signOut: () => void;
  /** Open login modal; run `onAuthed` after a successful sign-in (or immediately if already signed in). */
  requireAuth: (onAuthed?: () => void) => void;
  openLogin: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const configured = Boolean(getGoogleClientId());

  const applyCredential = useCallback((response: GoogleCredentialResponse) => {
    const next = userFromIdToken(response.credential);
    if (!next) return;
    storeUser(next);
    setUser(next);
    setLoginOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  useEffect(() => {
    setAuthTokenProvider(() => loadStoredUser()?.idToken ?? user?.idToken ?? null);
  }, [user]);

  useEffect(() => {
    const stored = loadStoredUser();
    if (stored) setUser(stored);

    if (!configured) {
      setReady(true);
      return;
    }

    initializeGoogleId(applyCredential)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [applyCredential, configured]);

  const signOut = useCallback(() => {
    signOutGoogle(user?.email);
    storeUser(null);
    setUser(null);
    pendingAction.current = null;
  }, [user?.email]);

  const openLogin = useCallback(() => {
    setLoginOpen(true);
  }, []);

  const requireAuth = useCallback(
    (onAuthed?: () => void) => {
      if (user) {
        onAuthed?.();
        return;
      }
      pendingAction.current = onAuthed ?? null;
      setLoginOpen(true);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin: isAdminEmail(user?.email),
      ready,
      configured,
      signOut,
      requireAuth,
      openLogin,
    }),
    [user, ready, configured, signOut, requireAuth, openLogin],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={loginOpen}
        configured={configured}
        onClose={() => {
          setLoginOpen(false);
          pendingAction.current = null;
        }}
        onCredential={applyCredential}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
