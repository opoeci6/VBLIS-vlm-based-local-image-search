import { useState, useEffect, useCallback } from 'react';
import { API_BASE, IS_NETWORK } from '../config';
import { apiFetch } from '../utils/api';
import { onSignedOut } from '../utils/session';
import { setCaseSensitivePaths } from '../utils/pathCase';
import { SessionProvider } from './SessionProvider';
import { SignInScreen, LoadingScreen, ConnectionErrorScreen } from './SessionScreens';

const readRetryAfter = (response) => {
  const seconds = Number.parseInt(response.headers?.get?.('Retry-After') ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

function NetworkGate({ children }) {
  // phase: 'loading' | 'error' | 'signedOut' | 'signedIn'
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const acceptSession = useCallback((info) => {
    // Set before the app renders: the folder tree compares paths with it.
    setCaseSensitivePaths(info.case_sensitive_paths);
    setState({ phase: 'signedIn', info });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/auth/session`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = await res.json();
        if (cancelled) return;
        if (info.signed_in) acceptSession(info);
        else setState({ phase: 'signedOut', secure: info.secure !== false });
      } catch {
        if (!cancelled) setState({ phase: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [attempt, acceptSession]);

  // Any API call answered with 401 means the session ended (expired, or a password was changed).
  useEffect(() => onSignedOut(() => {
    setState((prev) => (prev.phase === 'signedIn'
      ? { phase: 'signedOut', secure: prev.info.secure !== false, expired: true }
      : prev));
  }), []);

  const signIn = useCallback(async (password) => {
    try {
      const res = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        acceptSession(await res.json());
        return { ok: true };
      }
      let detail = '';
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
      } catch { /* no JSON body */ }
      return { ok: false, kind: 'http', status: res.status, detail, retryAfter: readRetryAfter(res) };
    } catch {
      return { ok: false, kind: 'network' };
    }
  }, [acceptSession]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch { /* the next call answers 401 if the cookie is still valid */ }
    setState((prev) => ({ phase: 'signedOut', secure: prev.info?.secure !== false }));
  }, []);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  if (state.phase === 'loading') return <LoadingScreen />;
  if (state.phase === 'error') return <ConnectionErrorScreen onRetry={retry} />;
  if (state.phase === 'signedOut') return <SignInScreen onSignIn={signIn} secure={state.secure} expired={Boolean(state.expired)} />;
  return <SessionProvider info={state.info} onSignOut={signOut}>{children}</SessionProvider>;
}

// Wraps the app. The desktop app renders it directly: no session request, no extra render.
export function SessionGate({ children }) {
  return IS_NETWORK ? <NetworkGate>{children}</NetworkGate> : children;
}
