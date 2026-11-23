import { useState, useEffect, useCallback, useRef } from 'react';
import { hashPassword, requestConfirmed } from '../utils/passwordRequests';
import { useSession } from '../session/sessionContext';

const DEFAULT_LIMITS = { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 };

// Where the accounts live for each mode. The desktop app manages them through its own API, which needs
// no password and updates with a POST; a browser signed in to the network server uses /server/accounts
// and asks for the owner's password.
const ROUTES = {
  desktop: { base: '/sharing/accounts', updateMethod: 'POST' },
  network: { base: '/server/accounts', updateMethod: 'PATCH' }
};

// The owner's own password is never sent: the network proves it with `confirm` (a challenge and its proof),
// and only when the caller was given the password. The desktop never confirms, whatever the caller passes.
// A new password is never sent either, only its hash.

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

  const call = useCallback(async (method, path, body, currentPassword) => {
    startedRef.current += 1;
    const number = startedRef.current;
    const result = await requestConfirmed(method, path, body, currentPassword);
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

  // Hashes `password`, then sends `body` with the hash as `password_hash` (and the confirmation, on the network).
  const sendHashed = useCallback(async (path, body, password, currentPassword) => {
    const hashed = await hashPassword(password);
    if (!hashed.ok) return hashed;
    return call('POST', path, { ...body, password_hash: hashed.hash }, isDesktop ? undefined : currentPassword);
  }, [call, isDesktop]);

  const add = useCallback(({ name, role, password, permissions, currentPassword }) => sendHashed(base, {
    name,
    role,
    ...(role === 'viewer' && permissions ? { permissions } : {})
  }, password, currentPassword), [sendHashed, base]);

  const update = useCallback((id, changes, currentPassword) => call(
    updateMethod, accountPath(id), changes, isDesktop ? undefined : currentPassword
  ), [call, updateMethod, accountPath, isDesktop]);

  const setPassword = useCallback((id, newPassword, currentPassword) => sendHashed(
    accountPath(id, '/password'), {}, newPassword, currentPassword
  ), [sendHashed, accountPath]);

  const signOut = useCallback((id) => call('POST', accountPath(id, '/sign-out')), [call, accountPath]);

  // The desktop's delete takes no body at all; the network's takes the confirmation (or `{}` while remembered).
  const remove = useCallback((id, currentPassword) => (
    isDesktop
      ? call('POST', accountPath(id, '/delete'))
      : call('POST', accountPath(id, '/delete'), {}, currentPassword)
  ), [call, accountPath, isDesktop]);

  return {
    accounts, you, limits, isLoading, loadFailed, reload, add, update, setPassword, signOut, remove,
    isConfirmRemembered, forgetConfirm
  };
};
