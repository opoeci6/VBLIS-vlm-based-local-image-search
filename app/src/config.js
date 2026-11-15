// True in a plain browser tab served by the network server (the UI at `/`, the API under `/api`,
// a session cookie instead of the token header). Decided once at load: Electron's preload sets
// window.electronAPI before any page script runs. Not network: Electron, tests, and the dev page that
// talks to a local backend with VITE_VBLIS_API_TOKEN set.
const detectNetworkMode = () => {
  if (typeof window === 'undefined' || window.electronAPI) return false;
  if (import.meta.env.MODE === 'test') return false;
  if (import.meta.env.DEV && import.meta.env.VITE_VBLIS_API_TOKEN) return false;
  return true;
};

export let IS_NETWORK = detectNetworkMode();

// Lets a test switch the mode on without reloading the module. API_BASE stays as it was computed.
export const setNetworkModeForTests = (value) => { IS_NETWORK = Boolean(value); };

export const API_BASE = IS_NETWORK ? `${window.location.origin}/api` : 'http://127.0.0.1:8000';

// Read lazily: Electron's preload sets it after this module could be imported, and tests set it.
// The env fallback is for a plain browser tab in dev; the DEV guard makes it dead code in a
// production build, so a token in the build environment is never baked into the bundle.
// In network mode the session cookie authenticates, so this is empty there (no header, no token= in URLs).
export const getApiToken = () => {
  if (typeof window !== 'undefined' && window.electronAPI?.apiToken) {
    return window.electronAPI.apiToken;
  }
  if (import.meta.env.DEV) return import.meta.env.VITE_VBLIS_API_TOKEN || '';
  return '';
};
