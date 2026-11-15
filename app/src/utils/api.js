import { getApiToken, IS_NETWORK } from '../config';
import { notifySignedOut } from './session';

export const API_TOKEN_HEADER = 'X-VBLIS-Token';

// fetch() that adds the backend's shared-secret header (see electron/main.js).
// In network mode there is no header (the session cookie goes along by itself); a 401 tells the app
// that the session ended, and the response is still returned to the caller.
export function apiFetch(url, options) {
  const token = getApiToken();
  let request;
  if (!token) request = options === undefined ? fetch(url) : fetch(url, options);
  else request = fetch(url, { ...options, headers: { ...options?.headers, [API_TOKEN_HEADER]: token } });
  if (!IS_NETWORK) return request;
  return request.then((response) => {
    if (response?.status === 401) notifySignedOut();
    return response;
  });
}
