// Structural deep-equal for JSON values (primitives, null, arrays, plain objects).
export const isJsonEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isJsonEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isJsonEqual(a[key], b[key])) return false;
  }
  return true;
};

// State updater that keeps the current state reference when `next` is structurally equal,
// so polling an unchanged endpoint does not trigger a re-render.
export const keepIfEqual = (next) => (prev) => (isJsonEqual(prev, next) ? prev : next);
