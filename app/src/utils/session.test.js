import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLoopbackHostname, isLoopbackPage } from './session';
import { stubPageHost } from '../test/pageHost';

describe('isLoopbackHostname', () => {
  it.each([
    'localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'a.b.localhost',
    '127.0.0.1', '127.0.0.2', '127.255.255.254', '127.1.2.3',
    '[::1]', '::1'
  ])('is true for %s', (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(true);
  });

  it.each([
    '', undefined, null,
    'example.com', 'localhost.example.com', 'notlocalhost', 'my-localhost',
    '192.168.1.5', '10.0.0.7', '126.0.0.1', '128.0.0.1', '127.0.0', '127.0.0.1.5', '127.0.0.256', '1127.0.0.1',
    '[::2]', '::', 'fe80::1', '[2001:db8::1]'
  ])('is false for %s', (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(false);
  });
});

describe('isLoopbackPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the host the page is served from', () => {
    stubPageHost('localhost');
    expect(isLoopbackPage()).toBe(true);
    stubPageHost('192.168.1.5');
    expect(isLoopbackPage()).toBe(false);
  });
});
