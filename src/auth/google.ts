import type { AuthUser, GoogleCredentialResponse } from './types';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const STORAGE_KEY = 'sm-google-auth';

let scriptPromise: Promise<void> | null = null;

type StoredAuth = {
  idToken?: string;
  profile?: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
};

export function getGoogleClientId(): string {
  return String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

/**
 * Admins from env. Supports:
 * - `VITE_ADMIN_EMAIL` (single / legacy)
 * - `VITE_ADMIN_EMAIL_1` … `VITE_ADMIN_EMAIL_10` (as many as you set)
 *
 * Names must be referenced statically so Vite embeds them at build time.
 */
export function getAdminEmails(): string[] {
  const raw = [
    import.meta.env.VITE_ADMIN_EMAIL,
    import.meta.env.VITE_ADMIN_EMAIL_1,
    import.meta.env.VITE_ADMIN_EMAIL_2,
    import.meta.env.VITE_ADMIN_EMAIL_3,
    import.meta.env.VITE_ADMIN_EMAIL_4,
    import.meta.env.VITE_ADMIN_EMAIL_5,
    import.meta.env.VITE_ADMIN_EMAIL_6,
    import.meta.env.VITE_ADMIN_EMAIL_7,
    import.meta.env.VITE_ADMIN_EMAIL_8,
    import.meta.env.VITE_ADMIN_EMAIL_9,
    import.meta.env.VITE_ADMIN_EMAIL_10,
  ];

  const emails = new Set<string>();
  for (const value of raw) {
    const email = String(value || '').trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

/** @deprecated Prefer getAdminEmails() — kept for older call sites. */
export function getAdminEmail(): string {
  return getAdminEmails()[0] || '';
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const admins = getAdminEmails();
  if (!admins.length) return false;
  return admins.includes(email.trim().toLowerCase());
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function userFromIdToken(idToken: string): AuthUser | null {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  // Reject tokens already expired (small skew allowed).
  if (exp && exp * 1000 < Date.now() - 30_000) return null;

  const id = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!id || !email) return null;

  return {
    id,
    email,
    name: typeof payload.name === 'string' ? payload.name : email.split('@')[0] || 'User',
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    idToken,
  };
}

function readRawStore(): StoredAuth | null {
  try {
    // Prefer localStorage (survives tab close). Migrate old sessionStorage once.
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) return JSON.parse(local) as StoredAuth;

    const session = sessionStorage.getItem(STORAGE_KEY);
    if (session) {
      localStorage.setItem(STORAGE_KEY, session);
      sessionStorage.removeItem(STORAGE_KEY);
      return JSON.parse(session) as StoredAuth;
    }
    return null;
  } catch {
    return null;
  }
}

/** Valid signed-in user with a non-expired Google ID token. */
export function loadStoredUser(): AuthUser | null {
  const parsed = readRawStore();
  if (!parsed?.idToken) return null;
  return userFromIdToken(parsed.idToken);
}

/** Last signed-in profile (may outlive the ID token) — used for silent re-auth. */
export function loadRememberedProfile(): StoredAuth['profile'] | null {
  return readRawStore()?.profile ?? null;
}

export function storeUser(user: AuthUser | null): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }

  if (!user) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  const payload: StoredAuth = {
    idToken: user.idToken,
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Google Sign-In')));
      if (window.google?.accounts?.id) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    // Google GIS requires a usable referrer on localhost HTTP.
    script.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Sign-In'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function initializeGoogleId(
  onCredential: (response: GoogleCredentialResponse) => void,
  options?: { autoSelect?: boolean },
): Promise<void> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Missing VITE_GOOGLE_CLIENT_ID');

  await loadGoogleScript();
  if (!window.google?.accounts?.id) throw new Error('Google Sign-In unavailable');

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: onCredential,
    auto_select: Boolean(options?.autoSelect),
    cancel_on_tap_outside: true,
    context: 'signin',
    ux_mode: 'popup',
  });
}

/** Try Google One Tap / auto-select to mint a fresh ID token without a button click. */
export function promptGoogleSignIn(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!window.google?.accounts?.id) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), 2800);

    try {
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          window.clearTimeout(timer);
          finish(false);
        }
        // Success path is handled by the initialize callback; keep waiting briefly.
      });
    } catch {
      window.clearTimeout(timer);
      finish(false);
    }
  });
}

export function renderGoogleButton(container: HTMLElement, width = 280): void {
  if (!window.google?.accounts?.id) return;
  container.replaceChildren();
  window.google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    width,
    logo_alignment: 'left',
  });
}

export function signOutGoogle(email?: string): void {
  try {
    window.google?.accounts.id.disableAutoSelect();
    if (email) {
      window.google?.accounts.id.revoke(email, () => undefined);
    }
  } catch {
    // ignore
  }
}
