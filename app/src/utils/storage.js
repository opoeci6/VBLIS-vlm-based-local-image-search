// localStorage helpers that never throw: storage can be blocked, missing or full, and saved JSON can
// be corrupt. A failed read returns the fallback; a failed write is ignored.
export const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; the value still applies for this session.
  }
};
