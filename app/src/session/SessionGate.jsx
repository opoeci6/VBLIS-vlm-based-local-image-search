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

  // Re-reads the session while signed in, so a change the owner made (name, role, permissions, account
  // turned off) shows up without a reload. A failed read keeps what is shown; identical info keeps the
  // same state object, so nothing re-renders.
  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/auth/session`);
      if (!res.ok) return;
      const info = await res.json();
      if (info.signed_in) setCaseSensitivePaths(info.case_sensitive_paths);
      setState((prev) => {
        if (prev.phase !== 'signedIn') return prev;
        if (!info.signed_in) return { phase: 'signedOut', secure: info.secure !== false, expired: true };
        return JSON.stringify(prev.info) === JSON.stringify(info) ? prev : { phase: 'signedIn', info };
      });
    } catch { /* keep the current state; the next call tells if the session ended */ }
  }, []);

  // An open tab picks up the owner's changes when it comes back to the front.
  const signedIn = state.phase === 'signedIn';
  useEffect(() => {
    if (!signedIn) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn, refresh]);

  const signIn = useCallback(async (name, password) => {
    try {
      const res = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password })
      });
      if (res.ok) {
        acceptSession(await res.json());
        return { ok: true };
      }
      let detail = '';
      let code = '';
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
        if (typeof body?.code === 'string') code = body.code;
      } catch { /* no JSON body */ }
      return { ok: false, kind: 'http', status: res.status, detail, code, retryAfter: readRetryAfter(res) };
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
  return <SessionProvider info={state.info} onSignOut={signOut} onRefresh={refresh}>{children}</SessionProvider>;
}

// Wraps the app. The desktop app renders it directly: no session request, no extra render.
export function SessionGate({ children }) {
  return IS_NETWORK ? <NetworkGate>{children}</NetworkGate> : children;
}
