import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { initializeGoogleId, renderGoogleButton } from './google';
import type { GoogleCredentialResponse } from './types';

type LoginModalProps = {
  open: boolean;
  configured: boolean;
  onClose: () => void;
  onCredential: (response: GoogleCredentialResponse) => void;
};

export function LoginModal({ open, configured, onClose, onCredential }: LoginModalProps) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !configured) return;
    let cancelled = false;

    void (async () => {
      try {
        await initializeGoogleId(onCredential);
        if (cancelled || !buttonRef.current) return;
        renderGoogleButton(buttonRef.current, Math.min(320, window.innerWidth - 64));
      } catch {
        // button stays empty; message below explains config
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, configured, onCredential]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="auth-login"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to upload"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="auth-login__card">
        <span className="auth-login__handle" aria-hidden="true" />
        <button type="button" className="auth-login__close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="auth-login__title">Sign in to upload</h2>
        <p className="auth-login__text">
          Use your Google account to create albums and add photos. Guests can still browse.
        </p>
        {configured ? (
          <div ref={buttonRef} className="auth-login__google" />
        ) : (
          <p className="auth-login__error">
            Google Sign-In is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in your env.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
