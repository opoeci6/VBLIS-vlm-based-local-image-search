import { vi } from 'vitest';

// jsdom serves tests from http://localhost, a loopback host, where the "this connection isn't encrypted"
// warnings stay hidden on purpose. A test of those warnings serves the page from another host with this.
// Undo it with vi.unstubAllGlobals().
export const stubPageHost = (hostname = '192.168.1.5') => {
  vi.stubGlobal('location', { ...window.location, hostname, host: hostname });
};
