export const API_BASE = 'http://127.0.0.1:8000';

// Read lazily: Electron's preload sets it after this module could be imported, and tests set it.
// The env fallback is for a plain browser tab in dev; the DEV guard makes it dead code in a
// production build, so a token in the build environment is never baked into the bundle.
export const getApiToken = () => {
  if (typeof window !== 'undefined' && window.electronAPI?.apiToken) {
    return window.electronAPI.apiToken;
  }
  if (import.meta.env.DEV) return import.meta.env.VITE_VBLIS_API_TOKEN || '';
  return '';
};
