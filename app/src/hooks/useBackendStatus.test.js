import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBackendStatus } from './useBackendStatus';

const API = 'http://127.0.0.1:8000';

const baseStatus = {
  is_indexing: false,
  errors: 0,
  last_task_id: 0,
  total_files: 0,
  discovered_video_count: 0,
  indexed_video_frames: 0,
};

// Serves /status from a mutable payload so tests can drive successive polls.
const setupFetch = (initial = baseStatus) => {
  const state = { payload: initial };
  const fetchMock = vi.fn(async (url, init) => {
    if (url === `${API}/status`) return { ok: true, json: async () => state.payload };
    if (url === `${API}/index/cancel` && init?.method === 'POST') return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
};

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useBackendStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches /status immediately and then every 1500 ms, and nothing else', async () => {
    const { fetchMock } = setupFetch();
    const setToast = vi.fn();
    renderHook(() => useBackendStatus({ setToast }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await tick(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1500);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(new Set(urls)).toEqual(new Set([`${API}/status`]));
  });

  it('exposes the polled status and stops polling on unmount', async () => {
    const { fetchMock, state } = setupFetch({ ...baseStatus, percent: 42 });
    const { result, unmount } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
    await flush();
    expect(result.current.status.percent).toBe(42);

    state.payload = { ...baseStatus, percent: 80 };
    await tick(1500);
    expect(result.current.status.percent).toBe(80);

    unmount();
    const callsAtUnmount = fetchMock.mock.calls.length;
    await tick(5000);
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it('survives an unreachable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
    await flush();
    expect(result.current.status.is_indexing).toBe(false);
  });

  it('shows the error alert when last_task_id increases with errors', async () => {
    const { state } = setupFetch();
    const setToast = vi.fn();
    const { result } = renderHook(() => useBackendStatus({ setToast }));
    await flush();
    expect(result.current.showErrorAlert).toBe(false);

    state.payload = { ...baseStatus, last_task_id: 1, errors: 2, total_files: 5 };
    await tick(1500);
    expect(result.current.showErrorAlert).toBe(true);
    expect(setToast).not.toHaveBeenCalled();
  });

  it('toasts the adaptive-frame summary when a task finishes without errors', async () => {
    const { state } = setupFetch();
    const setToast = vi.fn();
    renderHook(() => useBackendStatus({ setToast }));
    await flush();

    state.payload = {
      ...baseStatus, last_task_id: 1, errors: 0, total_files: 3,
      discovered_video_count: 2, indexed_video_frames: 17,
    };
    await tick(1500);
    expect(setToast).toHaveBeenCalledWith({
      message: 'Indexed 17 adaptive frame(s) from 2 video file(s).',
      type: 'success',
    });
  });

  it('toasts an error when a finished task found no files', async () => {
    const { state } = setupFetch();
    const setToast = vi.fn();
    renderHook(() => useBackendStatus({ setToast }));
    await flush();

    state.payload = { ...baseStatus, last_task_id: 1, total_files: 0, is_indexing: false };
    await tick(1500);
    expect(setToast).toHaveBeenCalledWith({
      message: 'No supported images or videos were found in the selected folder.',
      type: 'error',
    });
  });

  it('hides the alert when a new indexing run starts', async () => {
    const { state } = setupFetch();
    const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
    await flush();

    state.payload = { ...baseStatus, last_task_id: 1, errors: 1, total_files: 4 };
    await tick(1500);
    expect(result.current.showErrorAlert).toBe(true);

    state.payload = { ...baseStatus, last_task_id: 1, errors: 1, total_files: 4, is_indexing: true };
    await tick(1500);
    expect(result.current.showErrorAlert).toBe(false);
  });

  it('shows the alert on an indexing -> idle transition with errors', async () => {
    const { state } = setupFetch({ ...baseStatus, is_indexing: true, last_task_id: 1 });
    const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
    await flush();

    state.payload = { ...baseStatus, is_indexing: false, errors: 3, last_task_id: 1 };
    await tick(1500);
    expect(result.current.showErrorAlert).toBe(true);
  });

  it('handleCancelIndexing POSTs /index/cancel and sends the info toast', async () => {
    const { fetchMock } = setupFetch();
    const setToast = vi.fn();
    const { result } = renderHook(() => useBackendStatus({ setToast }));
    await flush();

    await act(async () => { await result.current.handleCancelIndexing(); });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/index/cancel`, { method: 'POST' });
    expect(setToast).toHaveBeenCalledWith({ message: 'Indexing cancellation requested.', type: 'info' });
    expect(result.current.isCancellingIndexing).toBe(false);
  });

  it('handleCancelIndexing reports a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url) => {
      if (url === `${API}/status`) return { ok: true, json: async () => baseStatus };
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', fetchMock);
    const setToast = vi.fn();
    const { result } = renderHook(() => useBackendStatus({ setToast }));
    await flush();

    await act(async () => { await result.current.handleCancelIndexing(); });
    expect(setToast).toHaveBeenCalledWith({ message: 'Failed to cancel indexing.', type: 'error' });
  });

  describe('poll state identity', () => {
    // Fresh deep copy per response, like a real network body.
    const setupFreshFetch = (initial) => {
      const state = { payload: initial };
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(state.payload)) })));
      return state;
    };

    it('keeps the same status reference when a poll returns an equal payload', async () => {
      setupFreshFetch({ ...baseStatus, failed_files: [{ path: '/x', error: 'bad' }] });
      const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
      await flush();
      const first = result.current.status;
      expect(first.failed_files).toEqual([{ path: '/x', error: 'bad' }]);

      await tick(1500);
      await tick(1500);
      expect(result.current.status).toBe(first);
    });

    it('returns a new reference with the new data when the payload changes', async () => {
      const state = setupFreshFetch({ ...baseStatus, percent: 10 });
      const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
      await flush();
      const first = result.current.status;

      state.payload = { ...baseStatus, percent: 20 };
      await tick(1500);
      expect(result.current.status).not.toBe(first);
      expect(result.current.status.percent).toBe(20);
    });

    it('compares against the current state so local updates are overwritten by an equal poll', async () => {
      setupFreshFetch({ ...baseStatus, is_downloading: false, download_error: 'old' });
      const { result } = renderHook(() => useBackendStatus({ setToast: vi.fn() }));
      await flush();
      expect(result.current.status.is_downloading).toBe(false);

      act(() => {
        result.current.setStatus(prev => ({ ...prev, is_downloading: true, download_error: null }));
      });
      expect(result.current.status.is_downloading).toBe(true);

      await tick(1500);
      expect(result.current.status.is_downloading).toBe(false);
      expect(result.current.status.download_error).toBe('old');
    });
  });
});
