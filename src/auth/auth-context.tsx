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
  loadRememberedProfile,
  loadStoredUser,
  promptGoogleSignIn,
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
  const userRef = useRef<AuthUser | null>(null);
  const loginOpenRef = useRef(false);
  const configured = Boolean(getGoogleClientId());

  userRef.current = user;
  loginOpenRef.current = loginOpen;

  const applyCredential = useCallback((response: GoogleCredentialResponse) => {
    const next = userFromIdToken(response.credential);
    if (!next) return;

    const wasLoggedOut = !userRef.current;
    const fromLoginUi = loginOpenRef.current;

    storeUser(next);
    setUser(next);
    setLoginOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();

    // Full reload after a real sign-in so albums/admin state refresh cleanly.
    // Skip when silently refreshing an already signed-in session.
    if (wasLoggedOut || fromLoginUi) {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    setAuthTokenProvider(() => loadStoredUser()?.idToken ?? userRef.current?.idToken ?? null);
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = loadStoredUser();
      if (stored) {
        setUser(stored);
      }

      if (!configured) {
        if (!cancelled) setReady(true);
        return;
      }

      const remembered = loadRememberedProfile();
      const shouldAutoSelect = Boolean(stored || remembered);

      try {
        await initializeGoogleId(applyCredential, { autoSelect: shouldAutoSelect });

        // Token expired (or first return after tab close with stale JWT): silently refresh.
        if (!stored && remembered) {
          await promptGoogleSignIn();
          if (!cancelled && !userRef.current) {
            // One Tap may have completed via applyCredential already.
            const refreshed = loadStoredUser();
            if (refreshed) setUser(refreshed);
          }
        }
      } catch {
        // Sign-in library unavailable — keep any valid stored session.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyCredential, configured]);

  // Keep API tokens fresh while the tab stays open (Google ID tokens ~1h).
  useEffect(() => {
    if (!configured || !user) return;

    const refresh = () => {
      const current = loadStoredUser();
      if (current) {
        if (current.idToken !== userRef.current?.idToken) {
          setUser(current);
        }
        return;
      }
      // Expired — try silent Google re-auth.
      void initializeGoogleId(applyCredential, { autoSelect: true })
        .then(() => promptGoogleSignIn())
        .then(() => {
          const next = loadStoredUser();
          if (next) setUser(next);
          else {
            storeUser(null);
            setUser(null);
          }
        })
        .catch(() => undefined);
    };

    const id = window.setInterval(refresh, 10 * 60 * 1000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [applyCredential, configured, user]);

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
      const live = loadStoredUser() ?? user;
      if (live) {
        if (live !== user) setUser(live);
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
