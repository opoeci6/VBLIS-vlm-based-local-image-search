import { API_BASE } from '../config';
import { apiFetch } from './api';
import { isReadOnlyRefusal, readOnlyMessage } from './replica';
import i18n from '../i18n';

// A sentence for a refused request: a wait for a 429, the read-only sentence when the library is a read-only copy
// (code read_only), else translated by the server's error `code`,
// else the server's English `detail`, else a generic line with the status.
const failureMessage = (res, body) => {
  if (res.status === 429) {
    const seconds = Number.parseInt(res.headers?.get?.('Retry-After') ?? '', 10);
    return seconds > 0
      ? i18n.t('session:server.errors.tooManyAttempts', { count: seconds })
      : i18n.t('session:server.errors.tooManyAttemptsNoWait');
  }
  if (isReadOnlyRefusal(body)) return readOnlyMessage();
  const key = `session:server.errors.codes.${body?.code}`;
  if (body?.code && i18n.exists(key)) return i18n.t(key);
  if (typeof body?.detail === 'string' && body.detail) return body.detail;
  return i18n.t('session:server.errors.generic', { status: res.status });
};

// One call to the network server's JSON API. It never throws:
//   { ok: true, data }                          the answer (null when it has no JSON body)
//   { ok: false, status, code, message }        a refusal, with a sentence ready to show
//   { ok: false, status: 0, code: null, message }  the server could not be reached
// A request without `body` sends no body and no Content-Type.
// With `keepErrorBody`, a refusal also carries the answer's JSON as `data` (null when it has none), for the
// callers that need more than the code, such as the extra fields of POST /sharing.
export const requestJson = async (method, path, body, { keepErrorBody = false } = {}) => {
  try {
    const res = await apiFetch(`${API_BASE}${path}`, body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data };
    const failure = { ok: false, status: res.status, code: data?.code ?? null, message: failureMessage(res, data) };
    return keepErrorBody ? { ...failure, data } : failure;
  } catch {
    return { ok: false, status: 0, code: null, message: i18n.t('session:server.errors.network') };
  }
};
