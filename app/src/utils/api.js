import { getApiToken } from '../config';

export const API_TOKEN_HEADER = 'X-VBLIS-Token';

// fetch() that adds the backend's shared-secret header (see electron/main.js)
export function apiFetch(url, options) {
  const token = getApiToken();
  if (!token) return options === undefined ? fetch(url) : fetch(url, options);
  return fetch(url, { ...options, headers: { ...options?.headers, [API_TOKEN_HEADER]: token } });
}
