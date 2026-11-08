export const getPathForFile = (file) => (
  window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(file) : file.path
);

export const isDirectory = async (path) => (
  window.electronAPI?.isDirectory ? window.electronAPI.isDirectory(path) : false
);

// The Electron session denies every permission, so the app copies through the main process.
// A plain browser (vite dev page) falls back to the web clipboard. Always resolves to { success, error? }.
export const copyText = async (text) => {
  try {
    if (window.electronAPI?.copyText) {
      const res = await window.electronAPI.copyText(text);
      return res?.success ? { success: true } : { success: false, error: res?.error || 'Could not copy.' };
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { success: true };
    }
    return { success: false, error: 'Clipboard is not available.' };
  } catch (error) {
    return { success: false, error: error?.message || 'Could not copy.' };
  }
};
