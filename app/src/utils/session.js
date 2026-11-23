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

// True for a host name that only this computer can reach: localhost, *.localhost, 127.0.0.0/8 and ::1.
// A page opened that way is not on the network (an SSH tunnel to the server ends here, already encrypted by
// SSH), so the "this connection isn't encrypted" warnings stay out of it.
export const isLoopbackHostname = (hostname) => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(parts[0]) === 127;
};

export const isLoopbackPage = () => isLoopbackHostname(window.location.hostname);
