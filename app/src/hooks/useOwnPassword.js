import { useCallback } from 'react';
import { requestJson } from '../utils/serverRequest';
import i18n from '../i18n';

// Any signed-in account changes its own password. Resolves to { ok: true } or { ok: false, code, message }
// for the form to show; the success toast is raised here.
export const useOwnPassword = ({ setToast }) => {
  const changePassword = useCallback(async ({ currentPassword, newPassword }) => {
    const result = await requestJson('POST', '/auth/password', { current_password: currentPassword, new_password: newPassword });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    setToast?.({ message: i18n.t('session:account.password.changed'), type: 'success' });
    return { ok: true };
  }, [setToast]);

  return { changePassword };
};
