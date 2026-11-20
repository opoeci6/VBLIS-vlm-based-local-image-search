// A small bus for "the server says the session is over" (a 401 on any API call in network mode).
const SIGNED_OUT_EVENT = 'vblis:signed-out';

export const notifySignedOut = () => {
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
};

// Returns the unsubscribe function.
export const onSignedOut = (handler) => {
  window.addEventListener(SIGNED_OUT_EVENT, handler);
  return () => window.removeEventListener(SIGNED_OUT_EVENT, handler);
};
