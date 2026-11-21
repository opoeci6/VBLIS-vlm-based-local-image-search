import i18n from '../i18n';

// Replica mode: the data folder holds a read-only copy of an index made on another computer, and the
// backend refuses every change to the index with HTTP 409 { detail, code: 'read_only' }.

// The computer the copy came from, kept here so code that runs outside React (the request helpers, a toast in
// a hook) can name it. The app sets it whenever the replica changes; null when unknown.
let knownHost = null;

export const rememberReplicaHost = (host) => {
  knownHost = typeof host === 'string' && host ? host : null;
};

export const isReadOnlyRefusal = (body) => body?.code === 'read_only';

// "This library is a read-only copy; indexing happens on {{host}}."
export const readOnlyMessage = () => (
  knownHost ? i18n.t('replica:refused', { host: knownHost }) : i18n.t('replica:refusedNoHost')
);

// The sentence for a refused request's JSON body: the read-only sentence for a read_only refusal, else `fallback`.
export const refusalText = (body, fallback) => (isReadOnlyRefusal(body) ? readOnlyMessage() : fallback);

// Task types the backend refuses to queue or retry on a copy.
export const INDEXING_TASK_TYPES = new Set(['INDEX_FOLDERS', 'REINDEX_FOLDER', 'BATCH_REINDEX', 'SCAN_MEDIA_INFO']);

// The JSON body of a refused response, or null when it has none (a mocked or broken response included).
export const readRefusalBody = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};
