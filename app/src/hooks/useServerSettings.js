import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';
import { apiFetch } from '../utils/api';
import i18n from '../i18n';

const postJson = (path, body) => apiFetch(`${API_BASE}${path}`, body === undefined
  ? { method: 'POST' }
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// A sentence for a refused request: translated by the server's error `code`, a wait for a 429, else the
// server's English `detail`.
const failureMessage = async (res) => {
  let body = null;
  try {
    body = await res.json();
  } catch { /* no JSON body */ }
  if (res.status === 429) {
    const seconds = Number.parseInt(res.headers?.get?.('Retry-After') ?? '', 10);
    return seconds > 0
      ? i18n.t('session:server.errors.tooManyAttempts', { count: seconds })
      : i18n.t('session:server.errors.tooManyAttemptsNoWait');
  }
  const key = `session:server.errors.codes.${body?.code}`;
  if (body?.code && i18n.exists(key)) return i18n.t(key);
  if (typeof body?.detail === 'string' && body.detail) return body.detail;
  return i18n.t('session:server.errors.generic', { status: res.status });
};

// The owner's view of the network server: its settings and the calls that change them (permissions of
// the viewer role, passwords, signing the other browsers out). Mount it only for a network owner.
// The password calls resolve to { ok: true } or { ok: false, message } for the form to show.
export const useServerSettings = ({ setToast }) => {
  const [settings, setSettings] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/server/settings`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setSettings(data);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setViewerPermission = useCallback(async (name, value) => {
    setIsSavingPermissions(true);
    try {
      const res = await apiFetch(`${API_BASE}/server/viewer-permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [name]: value })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSettings(await res.json());
    } catch {
      setToast?.({ message: i18n.t('session:server.viewers.saveFailed'), type: 'error' });
    } finally {
      setIsSavingPermissions(false);
    }
  }, [setToast]);

  // POST that updates `settings` from the answer and reports a refusal as { ok: false, message }.
  const post = useCallback(async (path, body = undefined) => {
    try {
      const res = await postJson(path, body);
      if (!res.ok) return { ok: false, message: await failureMessage(res) };
      return { ok: true, data: await res.json().catch(() => null) };
    } catch {
      return { ok: false, message: i18n.t('session:server.errors.network') };
    }
  }, []);

  const changePassword = useCallback(async ({ role, newPassword, currentPassword }) => {
    const result = await post('/server/password', { role, new_password: newPassword, current_password: currentPassword });
    if (!result.ok) return result;
    if (result.data) setSettings(result.data);
    setToast?.({
      message: role === 'owner' ? i18n.t('session:server.password.changedOwner') : i18n.t('session:server.password.changedViewer'),
      type: 'success'
    });
    return { ok: true };
  }, [post, setToast]);

  const removeViewerPassword = useCallback(async (currentPassword) => {
    const result = await post('/server/viewer-password/remove', { current_password: currentPassword });
    if (!result.ok) return result;
    if (result.data) setSettings(result.data);
    setToast?.({ message: i18n.t('session:server.removeViewer.removed'), type: 'success' });
    return { ok: true };
  }, [post, setToast]);

  const signOutOtherBrowsers = useCallback(async () => {
    const result = await post('/auth/sign-out-everywhere');
    setToast?.(result.ok
      ? { message: i18n.t('session:server.signOutOthers.done'), type: 'success' }
      : { message: result.message || i18n.t('session:server.signOutOthers.failed'), type: 'error' });
    return result;
  }, [post, setToast]);

  return { settings, loadFailed, isSavingPermissions, setViewerPermission, changePassword, removeViewerPassword, signOutOtherBrowsers };
};
