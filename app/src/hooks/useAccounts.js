import { useState, useEffect, useCallback, useRef } from 'react';
import { requestJson } from '../utils/serverRequest';
import { useSession } from '../session/sessionContext';

const DEFAULT_LIMITS = { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 };

// Where the accounts live for each mode. The desktop app manages them through its own API, which needs
// no password and updates with a POST; a browser signed in to the network server uses /server/accounts
// and asks for the owner's password.
const ROUTES = {
  desktop: { base: '/sharing/accounts', updateMethod: 'POST' },
  network: { base: '/server/accounts', updateMethod: 'PATCH' }
};

// The desktop never sends a password, whatever the caller passes; the network sends the one it was given.
const withPassword = (isDesktop, body, currentPassword) => (
  isDesktop || currentPassword === undefined ? body : { ...body, current_password: currentPassword }
);

// Refusals after which the server no longer remembers the owner's password.
const FORGETTING_CODES = new Set(['wrong_password', 'confirm_password']);

// The named accounts of the network server, for its owner: from the Windows app (`mode` 'desktop') or from
// a browser ('network', the default is the session's mode). Every call answers with the new list, which
// replaces `accounts`. Mutations resolve to { ok: true } or { ok: false, code, message, status } and leave
// the list alone on a refusal.
// In network mode the server remembers a correct password for a few minutes: `isConfirmRemembered()` says
// whether it still does, and `forgetConfirm()` drops the memory (after a 403 confirm_password).
export const useAccounts = ({ mode: modeOption } = {}) => {
  const session = useSession();
  const mode = modeOption ?? session.mode;
  const { base, updateMethod } = ROUTES[mode] ?? ROUTES.network;
  const isDesktop = mode === 'desktop';
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
  // When the server stops remembering the password (a timestamp in ms); 0 when it does not.
  const confirmUntilRef = useRef(0);

  const accountPath = useCallback((id, suffix = '') => `${base}/${encodeURIComponent(id)}${suffix}`, [base]);

  const forgetConfirm = useCallback(() => { confirmUntilRef.current = 0; }, []);

  const isConfirmRemembered = useCallback(() => confirmUntilRef.current > Date.now(), []);

  const applyAnswer = useCallback((number, data) => {
    if (!isMountedRef.current || !Array.isArray(data?.accounts) || number <= appliedRef.current) return;
    appliedRef.current = number;
    setAccounts(data.accounts);
    if (typeof data.you === 'string') setYou(data.you);
    if (data.limits) setLimits({ ...DEFAULT_LIMITS, ...data.limits });
    if (typeof data.confirm_remembered_s === 'number') {
      confirmUntilRef.current = data.confirm_remembered_s > 0 ? Date.now() + data.confirm_remembered_s * 1000 : 0;
    }
  }, []);

  const call = useCallback(async (method, path, body) => {
    startedRef.current += 1;
    const number = startedRef.current;
    const result = await requestJson(method, path, body);
    if (!result.ok) {
      if (FORGETTING_CODES.has(result.code)) confirmUntilRef.current = 0;
      return result;
    }
    applyAnswer(number, result.data);
    return { ok: true };
  }, [applyAnswer]);

  const reload = useCallback(async () => {
    setLoadFailed(false);
    setIsLoading(true);
    const result = await call('GET', base);
    if (!isMountedRef.current) return;
    if (!result.ok) setLoadFailed(true);
    setIsLoading(false);
  }, [call, base]);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => { isMountedRef.current = false; };
  }, [reload]);

  const add = useCallback(({ name, role, password, permissions, currentPassword }) => call('POST', base, withPassword(isDesktop, {
    name,
    role,
    password,
    ...(role === 'viewer' && permissions ? { permissions } : {})
  }, currentPassword)), [call, base, isDesktop]);

  const update = useCallback((id, changes, currentPassword) => call(updateMethod, accountPath(id), {
    ...changes,
    ...(!isDesktop && currentPassword ? { current_password: currentPassword } : {})
  }), [call, updateMethod, accountPath, isDesktop]);

  const setPassword = useCallback((id, newPassword, currentPassword) => call('POST', accountPath(id, '/password'), withPassword(isDesktop, {
    new_password: newPassword
  }, currentPassword)), [call, accountPath, isDesktop]);

  const signOut = useCallback((id) => call('POST', accountPath(id, '/sign-out')), [call, accountPath]);

  // The desktop's delete takes no body at all; the network's takes the password (or `{}` while remembered).
  const remove = useCallback((id, currentPassword) => (
    isDesktop
      ? call('POST', accountPath(id, '/delete'))
      : call('POST', accountPath(id, '/delete'), withPassword(isDesktop, {}, currentPassword))
  ), [call, accountPath, isDesktop]);

  return {
    accounts, you, limits, isLoading, loadFailed, reload, add, update, setPassword, signOut, remove,
    isConfirmRemembered, forgetConfirm
  };
};
