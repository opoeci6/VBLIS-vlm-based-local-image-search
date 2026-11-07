import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCacheStats } from './useCacheStats';

const API = 'http://127.0.0.1:8000';

const statsPayload = {
  images: { count: 3, bytes: 3000, formatted: '2.93 KB' },
  videos: { count: 1, bytes: 1000, formatted: '1000 B' },
  total: { count: 4, bytes: 4000, formatted: '3.91 KB' },
};

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe('useCacheStats', () => {
  let fetchMock;
  let routes;
  let setToast;

  const statsCalls = () => fetchMock.mock.calls.filter(([url]) => url === `${API}/image/cache/stats`);
  const idle = { is_rebuilding_video_thumbnails: false, is_indexing: false };

  const render = (overrides = {}) =>
    renderHook((p) => useCacheStats(p), { initialProps: { isSettingsOpen: true, status: idle, setToast, ...overrides } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setToast = vi.fn();
    routes = {};
    fetchMock = vi.fn(async (url, init) => {
      const key = `${init?.method || 'GET'} ${url}`;
      if (routes[key]) return routes[key](url, init);
      if (key === `GET ${API}/image/cache/stats`) return jsonResponse(statsPayload);
      throw new Error(`unexpected fetch ${key}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('stats fetching', () => {
    it('fetches when settings is open and exposes the stats', async () => {
      const { result } = render();
      await flush();
      expect(statsCalls()).toHaveLength(1);
      expect(result.current.cacheStats).toEqual(statsPayload);
    });

    it('does not fetch while settings is closed, and fetches when it opens', async () => {
      const { rerender } = render({ isSettingsOpen: false });
      await flush();
      expect(statsCalls()).toHaveLength(0);

      rerender({ isSettingsOpen: true, status: idle, setToast });
      await flush();
      expect(statsCalls()).toHaveLength(1);
    });

    it('refetches when the rebuild flag flips while open, but not while closed', async () => {
      const { rerender } = render();
      await flush();
      rerender({ isSettingsOpen: true, status: { ...idle, is_rebuilding_video_thumbnails: true }, setToast });
      await flush();
      expect(statsCalls()).toHaveLength(2);
      rerender({ isSettingsOpen: true, status: idle, setToast });
      await flush();
      expect(statsCalls()).toHaveLength(3);

      rerender({ isSettingsOpen: false, status: idle, setToast });
      await flush();
      rerender({ isSettingsOpen: false, status: { ...idle, is_rebuilding_video_thumbnails: true }, setToast });
      await flush();
      expect(statsCalls()).toHaveLength(3);
    });

    it('does not make extra requests when re-rendered with identical props', async () => {
      const props = { isSettingsOpen: true, status: idle, setToast };
      const { rerender } = render();
      await flush();
      for (let i = 0; i < 4; i++) rerender({ ...props });
      await flush();
      expect(statsCalls()).toHaveLength(1);
    });

    it('keeps the default stats when the request fails', async () => {
      routes[`GET ${API}/image/cache/stats`] = async () => { throw new Error('down'); };
      const { result } = render();
      await flush();
      expect(result.current.cacheStats.total.formatted).toBe('0 B');
    });
  });

  describe('handleClearThumbnailCache', () => {
    it('POSTs the target, toasts, refetches stats and resets the confirm state', async () => {
      routes[`POST ${API}/image/cache/clear?target=videos`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      act(() => result.current.setShowConfirmClearThumbnails('videos'));
      expect(result.current.showConfirmClearThumbnails).toBe('videos');

      await act(async () => { await result.current.handleClearThumbnailCache('videos'); });
      await flush();

      expect(fetchMock).toHaveBeenCalledWith(`${API}/image/cache/clear?target=videos`, { method: 'POST' });
      expect(setToast).toHaveBeenCalledWith({ message: 'Video thumbnail cache cleared successfully.', type: 'success' });
      expect(statsCalls()).toHaveLength(2);
      expect(result.current.showConfirmClearThumbnails).toBeNull();
      expect(result.current.isClearingThumbnails).toBe(false);
    });

    it('defaults to all and labels images', async () => {
      routes[`POST ${API}/image/cache/clear?target=all`] = async () => jsonResponse({});
      routes[`POST ${API}/image/cache/clear?target=images`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleClearThumbnailCache(); });
      expect(setToast).toHaveBeenLastCalledWith({ message: 'All thumbnail cache cleared successfully.', type: 'success' });
      await act(async () => { await result.current.handleClearThumbnailCache('images'); });
      expect(setToast).toHaveBeenLastCalledWith({ message: 'Image thumbnail cache cleared successfully.', type: 'success' });
    });

    it('shows the API error detail on failure', async () => {
      routes[`POST ${API}/image/cache/clear?target=all`] = async () => jsonResponse({ detail: 'locked' }, false);
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleClearThumbnailCache(); });
      expect(setToast).toHaveBeenCalledWith({ message: 'locked', type: 'error' });
      expect(statsCalls()).toHaveLength(1);
    });
  });

  describe('handleRebuildVideoThumbnails', () => {
    it.each([
      ['rebuilding', { is_rebuilding_video_thumbnails: true, is_indexing: false }],
      ['indexing', { is_rebuilding_video_thumbnails: false, is_indexing: true }],
    ])('is a no-op while %s', async (_label, status) => {
      const { result } = render({ status });
      await flush();
      const before = fetchMock.mock.calls.length;
      await act(async () => { await result.current.handleRebuildVideoThumbnails(); });
      expect(fetchMock.mock.calls.length).toBe(before);
      expect(setToast).not.toHaveBeenCalled();
    });

    it('starts a rebuild, toasts info and refetches stats', async () => {
      routes[`POST ${API}/video/thumbnails/regenerate`] = async () => jsonResponse({});
      const { result } = render();
      await flush();

      await act(async () => { await result.current.handleRebuildVideoThumbnails(); });
      await flush();

      expect(fetchMock).toHaveBeenCalledWith(`${API}/video/thumbnails/regenerate`, { method: 'POST' });
      expect(setToast).toHaveBeenCalledWith({ message: 'Video thumbnail rebuilding started in background.', type: 'info' });
      expect(statsCalls()).toHaveLength(2);
      expect(result.current.isTriggeringRebuildThumbnails).toBe(false);
    });

    it('reports a backend error and a connection failure', async () => {
      routes[`POST ${API}/video/thumbnails/regenerate`] = async () => jsonResponse({ detail: 'busy' }, false);
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleRebuildVideoThumbnails(); });
      expect(setToast).toHaveBeenLastCalledWith({ message: 'busy', type: 'error' });

      routes[`POST ${API}/video/thumbnails/regenerate`] = async () => { throw new Error('down'); };
      await act(async () => { await result.current.handleRebuildVideoThumbnails(); });
      expect(setToast).toHaveBeenLastCalledWith({ message: 'Failed to connect to backend.', type: 'error' });
    });
  });
});
