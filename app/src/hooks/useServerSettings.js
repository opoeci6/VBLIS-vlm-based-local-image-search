import { useState, useEffect, useCallback, useRef } from 'react';
import { requestJson } from '../utils/serverRequest';
import i18n from '../i18n';

// The owner's view of the network server: its settings and signing the other browsers out.
// Mount it only for a network owner. Accounts live in useAccounts.
export const useServerSettings = ({ setToast }) => {
  const [settings, setSettings] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const isMountedRef = useRef(true);

  // A failed re-read keeps what is shown; `loadFailed` only matters while there is nothing to show.
  const reload = useCallback(async () => {
    const result = await requestJson('GET', '/server/settings');
    if (!isMountedRef.current) return;
    if (result.ok && result.data) {
      setSettings(result.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => { isMountedRef.current = false; };
  }, [reload]);

  const signOutOtherBrowsers = useCallback(async () => {
    const result = await requestJson('POST', '/auth/sign-out-everywhere');
    setToast?.(result.ok
      ? { message: i18n.t('session:server.signOutOthers.done'), type: 'success' }
      : { message: result.message || i18n.t('session:server.signOutOthers.failed'), type: 'error' });
    return result;
  }, [setToast]);

  return { settings, loadFailed, reload, signOutOtherBrowsers };
};
