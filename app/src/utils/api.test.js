import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, API_TOKEN_HEADER } from './api';
import { setNetworkModeForTests } from '../config';
import { onSignedOut } from './session';

describe('apiFetch', () => {
  let originalElectronAPI;
  let fetchMock;

  beforeEach(() => {
    originalElectronAPI = window.electronAPI;
    delete window.electronAPI;
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalElectronAPI === undefined) delete window.electronAPI;
    else window.electronAPI = originalElectronAPI;
  });

  describe('without a token', () => {
    it('passes a bare url through unchanged', async () => {
      await apiFetch('http://x/status');
      expect(fetchMock).toHaveBeenCalledWith('http://x/status');
      expect(fetchMock.mock.calls[0]).toHaveLength(1);
    });

    it('passes the options object through unchanged', async () => {
      const options = { method: 'POST' };
      await apiFetch('http://x/a', options);
      expect(fetchMock).toHaveBeenCalledWith('http://x/a', { method: 'POST' });
      expect(fetchMock.mock.calls[0][1]).toBe(options);
    });

    it('treats an empty token like no token', async () => {
      window.electronAPI = { apiToken: '' };
      await apiFetch('http://x/a', { method: 'POST' });
      expect(fetchMock).toHaveBeenCalledWith('http://x/a', { method: 'POST' });
    });
  });

  describe('with a token', () => {
    beforeEach(() => {
      window.electronAPI = { apiToken: 't' };
    });

    it('adds the token header when called with only a url', async () => {
      await apiFetch('http://x/status');
      expect(fetchMock).toHaveBeenCalledWith('http://x/status', { headers: { [API_TOKEN_HEADER]: 't' } });
    });

    it('keeps method, body and existing headers', async () => {
      const body = JSON.stringify({ a: 1 });
      await apiFetch('http://x/a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      expect(fetchMock).toHaveBeenCalledWith('http://x/a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-VBLIS-Token': 't' },
        body,
      });
    });

    it('does not add a Content-Type for FormData bodies', async () => {
      const body = new FormData();
      await apiFetch('http://x/a', { method: 'POST', body });
      const sent = fetchMock.mock.calls[0][1];
      expect(sent.body).toBe(body);
      expect(sent.headers).toEqual({ 'X-VBLIS-Token': 't' });
    });

    it('does not mutate the caller options or headers', async () => {
      const headers = { 'Content-Type': 'application/json' };
      const options = { method: 'POST', headers };
      await apiFetch('http://x/a', options);
      expect(options).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
      expect(options.headers).toBe(headers);
      expect(headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('returns the fetch result', async () => {
      await expect(apiFetch('http://x/a')).resolves.toEqual({ ok: true });
    });
  });
});

describe('apiFetch signed-out notice', () => {
  let fetchMock;
  let notified;
  let unsubscribe;

  beforeEach(() => {
    delete window.electronAPI;
    notified = vi.fn();
    unsubscribe = onSignedOut(notified);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    unsubscribe();
    setNetworkModeForTests(false);
    vi.unstubAllGlobals();
  });

  it('notifies on a 401 in network mode and still returns the response', async () => {
    setNetworkModeForTests(true);
    const response = { ok: false, status: 401 };
    fetchMock.mockResolvedValue(response);
    await expect(apiFetch('/api/status')).resolves.toBe(response);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('does not notify on other statuses in network mode', async () => {
    setNetworkModeForTests(true);
    for (const status of [200, 403, 429, 500]) {
      fetchMock.mockResolvedValue({ ok: status === 200, status });
      await apiFetch('/api/status');
    }
    expect(notified).not.toHaveBeenCalled();
  });

  it('sends no token header in network mode', async () => {
    setNetworkModeForTests(true);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await apiFetch('/api/status', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('/api/status', { method: 'POST' });
  });

  it('does not notify on a 401 on the desktop', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await apiFetch('http://x/status');
    expect(notified).not.toHaveBeenCalled();
  });

  it('lets a network error through unchanged', async () => {
    setNetworkModeForTests(true);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(apiFetch('/api/status')).rejects.toThrow('offline');
    expect(notified).not.toHaveBeenCalled();
  });
});
