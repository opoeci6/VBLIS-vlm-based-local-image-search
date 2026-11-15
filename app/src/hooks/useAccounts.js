import { useState, useEffect, useCallback, useRef } from 'react';
import { requestJson } from '../utils/serverRequest';

const DEFAULT_LIMITS = { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 };

const accountPath = (id, suffix = '') => `/server/accounts/${encodeURIComponent(id)}${suffix}`;

// The named accounts of the network server, for its owner. Every call answers with the new list, which
// replaces `accounts`. Mutations resolve to { ok: true } or { ok: false, code, message, status } and leave
// the list alone on a refusal.
export const useAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [you, setYou] = useState(null);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const isMountedRef = useRef(true);
  // Requests are numbered when they start; an answer is applied only when it is newer than the last one
  // applied, so a slow old answer cannot bring back an old list.
  const startedRef = useRef(0);
  const appliedRef = useRef(0);

  const applyAnswer = useCallback((number, data) => {
    if (!isMountedRef.current || !Array.isArray(data?.accounts) || number <= appliedRef.current) return;
    appliedRef.current = number;
    setAccounts(data.accounts);
    if (typeof data.you === 'string') setYou(data.you);
    if (data.limits) setLimits({ ...DEFAULT_LIMITS, ...data.limits });
  }, []);

  const call = useCallback(async (method, path, body) => {
    startedRef.current += 1;
    const number = startedRef.current;
    const result = await requestJson(method, path, body);
    if (!result.ok) return result;
    applyAnswer(number, result.data);
    return { ok: true };
  }, [applyAnswer]);

  const reload = useCallback(async () => {
    setLoadFailed(false);
    setIsLoading(true);
    const result = await call('GET', '/server/accounts');
    if (!isMountedRef.current) return;
    if (!result.ok) setLoadFailed(true);
    setIsLoading(false);
  }, [call]);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => { isMountedRef.current = false; };
  }, [reload]);

  const add = useCallback(({ name, role, password, permissions, currentPassword }) => call('POST', '/server/accounts', {
    name,
    role,
    password,
    ...(role === 'viewer' && permissions ? { permissions } : {}),
    current_password: currentPassword
  }), [call]);

  const update = useCallback((id, changes, currentPassword) => call('PATCH', accountPath(id), {
    ...changes,
    ...(currentPassword ? { current_password: currentPassword } : {})
  }), [call]);

  const setPassword = useCallback((id, newPassword, currentPassword) => call('POST', accountPath(id, '/password'), {
    new_password: newPassword,
    current_password: currentPassword
  }), [call]);

  const signOut = useCallback((id) => call('POST', accountPath(id, '/sign-out')), [call]);

  const remove = useCallback((id, currentPassword) => call('POST', accountPath(id, '/delete'), {
    current_password: currentPassword
  }), [call]);

  return { accounts, you, limits, isLoading, loadFailed, reload, add, update, setPassword, signOut, remove };
};
