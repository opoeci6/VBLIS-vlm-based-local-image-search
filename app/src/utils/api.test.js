import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, API_TOKEN_HEADER } from './api';

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
