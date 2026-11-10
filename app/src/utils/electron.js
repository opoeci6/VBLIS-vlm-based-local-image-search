import i18n from '../i18n';

// The main process answers in English (app/electron/main.js). The two known messages are translated here;
// anything else (an exception text, a future message) passes through unchanged.
export const translateElectronError = (error) => {
  if (error === 'File no longer exists.') return i18n.t('common:errors.fileNoLongerExists');
  if (error === 'Nothing to copy.') return i18n.t('common:errors.nothingToCopy');
  return error;
};

export const getPathForFile = (file) => (
  window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(file) : file.path
);

export const isDirectory = async (path) => (
  window.electronAPI?.isDirectory ? window.electronAPI.isDirectory(path) : false
);

// Reveals a file in Explorer. Resolves to { success, error? } with the error already translated, or to
// null when there is no Electron bridge (a plain browser).
export const openInExplorer = async (path) => {
  if (!window.electronAPI?.openInExplorer) return null;
  const res = await window.electronAPI.openInExplorer(path);
  return res && res.error ? { ...res, error: translateElectronError(res.error) } : res;
};

// The Electron session denies every permission, so the app copies through the main process.
// A plain browser (vite dev page) falls back to the web clipboard. Always resolves to { success, error? }.
export const copyText = async (text) => {
  try {
    if (window.electronAPI?.copyText) {
      const res = await window.electronAPI.copyText(text);
      return res?.success ? { success: true } : { success: false, error: translateElectronError(res?.error) || i18n.t('common:errors.couldNotCopy') };
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { success: true };
    }
    return { success: false, error: i18n.t('common:errors.clipboardUnavailable') };
  } catch (error) {
    return { success: false, error: error?.message || i18n.t('common:errors.couldNotCopy') };
  }
};
