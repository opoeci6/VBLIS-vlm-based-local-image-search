import { useState, useEffect, useCallback, useRef } from 'react';
import { requestJson } from '../utils/serverRequest';
import i18n from '../i18n';

// A sentence for one of the "problems" the backend lists: translated by its code when there is a
// translation, else the backend's own (English) message.
export const problemText = (problem) => {
  const key = `session:server.errors.codes.${problem?.code}`;
  if (problem?.code && i18n.exists(key)) return i18n.t(key);
  return problem?.message || i18n.t('session:server.errors.codes.start_failed');
};

// The Windows app's view of "Share on my network": GET /sharing once, when the section mounts, and POST
// /sharing for every change. It never polls; the title bar pill reads the status poll instead.
//   state          the last view of the settings (null until loaded)
//   apply(changes) resolves to { ok: true } or { ok: false, code, message, problems, saved? }
//   signOutEverywhere() resolves to { ok: true } or { ok: false, message }
// A refusal that carries the new state (sharing could not start, or stopped without being saved) updates
// `state` from it, so the section shows what is true now.
export const useSharing = () => {
  const [state, setState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const isMountedRef = useRef(true);
  // Requests are numbered when they start; an answer is applied only when it is newer than the last one
  // applied, so a slow old answer cannot bring back an old state.
  const startedRef = useRef(0);
  const appliedRef = useRef(0);

  const applyView = useCallback((number, view) => {
    if (!isMountedRef.current || !view || typeof view !== 'object' || number <= appliedRef.current) return;
    appliedRef.current = number;
    setState(view);
  }, []);

  const reload = useCallback(async () => {
    startedRef.current += 1;
    const number = startedRef.current;
    setLoadFailed(false);
    const result = await requestJson('GET', '/sharing');
    if (!isMountedRef.current) return;
    if (result.ok && result.data) applyView(number, result.data);
    else setLoadFailed(true);
    setIsLoading(false);
  }, [applyView]);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => { isMountedRef.current = false; };
  }, [reload]);

  const track = useCallback(async (action) => {
    setBusyCount((count) => count + 1);
    try {
      return await action();
    } finally {
      if (isMountedRef.current) setBusyCount((count) => count - 1);
    }
  }, []);

  const apply = useCallback((changes) => track(async () => {
    startedRef.current += 1;
    const number = startedRef.current;
    const result = await requestJson('POST', '/sharing', changes, { keepErrorBody: true });
    if (result.ok) {
      applyView(number, result.data);
      return { ok: true };
    }
    const { code, data } = result;
    if (data?.sharing) applyView(number, data.sharing);
    const failure = { ok: false, status: result.status, code, message: result.message, problems: [] };
    if (code === 'start_failed' && Array.isArray(data?.problems) && data.problems.length > 0) {
      return { ...failure, message: problemText(data.problems[0]), problems: data.problems, saved: Boolean(data.saved) };
    }
    if (code === 'invalid_setting' && typeof data?.detail === 'string' && data.detail) {
      return { ...failure, message: i18n.t('session:server.errors.invalidSetting', { reason: data.detail }) };
    }
    return failure;
  }), [track, applyView]);

  const signOutEverywhere = useCallback(() => track(async () => {
    const result = await requestJson('POST', '/sharing/sign-out-everywhere');
    return result.ok ? { ok: true } : { ok: false, code: result.code, message: result.message };
  }), [track]);

  return { state, isLoading, loadFailed, isBusy: busyCount > 0, apply, signOutEverywhere, reload };
};
