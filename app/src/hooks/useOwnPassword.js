import { useCallback } from 'react';
import { hashPassword, requestConfirmed } from '../utils/passwordRequests';
import i18n from '../i18n';

// Any signed-in account changes its own password. Neither password is sent: the new one goes as its hash, the
// current one as a proof that answers a challenge. Resolves to { ok: true } or { ok: false, code, message }
// for the form to show; the success toast is raised here.
export const useOwnPassword = ({ setToast }) => {
  const changePassword = useCallback(async ({ currentPassword, newPassword }) => {
    const hashed = await hashPassword(newPassword);
    if (!hashed.ok) return { ok: false, code: hashed.code, message: hashed.message };
    const result = await requestConfirmed('POST', '/auth/password', { password_hash: hashed.hash }, currentPassword);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    setToast?.({ message: i18n.t('session:account.password.changed'), type: 'success' });
    return { ok: true };
  }, [setToast]);

  return { changePassword };
};
