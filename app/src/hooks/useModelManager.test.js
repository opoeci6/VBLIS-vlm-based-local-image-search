import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useModelManager } from './useModelManager';

const API = 'http://127.0.0.1:8000';

const idleStatus = {
  is_downloading: false,
  download_total_bytes: 0,
  download_error: null,
};

const modelsPayload = { active_model: 'org/model-a', models: [{ name: 'org/model-a' }] };
const gpuPayload = { use_gpu: false, batch_size: 0, precision_mode: 'auto' };

// Routes fetches by URL; `overrides` maps "METHOD url" or "url" to a handler.
const setupFetch = (overrides = {}) => {
  const fetchMock = vi.fn(async (url, init) => {
    const key = `${init?.method || 'GET'} ${url}`;
    if (overrides[key]) return overrides[key](url, init);
    if (url === `${API}/models` && !init) return { ok: true, json: async () => modelsPayload };
    if (url === `${API}/settings/gpu` && !init) return { ok: true, json: async () => gpuPayload };
    throw new Error(`unexpected fetch ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const makeQueue = (extra = {}) => ({ activeTask: null, pendingCount: 0, fetchQueue: vi.fn(), ...extra });

const render = (props = {}) => {
  const setToast = vi.fn();
  const setStatus = vi.fn();
  const onSwitchStart = vi.fn();
  const queue = props.queue || makeQueue();
  const initialProps = { status: idleStatus, setStatus, queue, setToast, onSwitchStart, ...props };
  const hook = renderHook((p) => useModelManager(p), { initialProps });
  return { ...hook, setToast, setStatus, onSwitchStart, queue };
};

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const urlsOf = (fetchMock) => fetchMock.mock.calls.map(([url]) => url);

describe('useModelManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('polling', () => {
    it('fetches /settings/gpu then /models immediately and every 1500 ms, never /status', async () => {
      const fetchMock = setupFetch();
      const { result } = render();
      await flush();

      // Immediate tick (the follow-up /models refresh effect also runs once backendReady flips).
      const first = urlsOf(fetchMock);
      expect(first.slice(0, 2)).toEqual([`${API}/settings/gpu`, `${API}/models`]);
      expect(result.current.backendReady).toBe(true);
      expect(result.current.models).toEqual(modelsPayload);
      expect(result.current.gpuSettings).toEqual(gpuPayload);

      const before = urlsOf(fetchMock).length;
      await tick(1500);
      const after = urlsOf(fetchMock).slice(before);
      expect(after).toEqual([`${API}/settings/gpu`, `${API}/models`]);

      await tick(1500);
      expect(urlsOf(fetchMock).filter(u => u === `${API}/settings/gpu`)).toHaveLength(3);
      expect(urlsOf(fetchMock).some(u => u.endsWith('/status'))).toBe(false);
    });

    it('keeps backendReady false while /models is unreachable and stops polling on unmount', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
      vi.stubGlobal('fetch', fetchMock);
      const { result, unmount } = render();
      await flush();
      expect(result.current.backendReady).toBe(false);

      unmount();
      const calls = fetchMock.mock.calls.length;
      await tick(5000);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });
  });

  describe('handleModelSwitch', () => {
    it.each(['running', 'paused'])('warns (active_task) when a task is %s and does not POST', async (taskStatus) => {
      const fetchMock = setupFetch();
      const { result } = render({ queue: makeQueue({ activeTask: { id: 1, status: taskStatus } }) });
      await flush();
      const calls = fetchMock.mock.calls.length;

      await act(async () => { await result.current.handleModelSwitch('org/model-b'); });
      expect(result.current.modelSwitchWarning).toEqual({ isOpen: true, mode: 'active_task', targetModel: 'org/model-b' });
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('warns (queued_tasks) when tasks are pending', async () => {
      const fetchMock = setupFetch();
      const { result } = render({ queue: makeQueue({ pendingCount: 2 }) });
      await flush();
      const calls = fetchMock.mock.calls.length;

      await act(async () => { await result.current.handleModelSwitch('org/model-b'); });
      expect(result.current.modelSwitchWarning).toEqual({ isOpen: true, mode: 'queued_tasks', targetModel: 'org/model-b' });
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('switches immediately when idle', async () => {
      const switched = { active_model: 'org/model-b', models: [] };
      let modelsResponse = modelsPayload;
      const fetchMock = setupFetch();
      fetchMock.mockImplementation(async (url, init) => {
        if (init?.method === 'POST' && url === `${API}/models/switch`) {
          modelsResponse = switched;
          return { ok: true, json: async () => ({}) };
        }
        if (url === `${API}/models`) return { ok: true, json: async () => modelsResponse };
        if (url === `${API}/settings/gpu`) return { ok: true, json: async () => gpuPayload };
        throw new Error(`unexpected fetch ${url}`);
      });
      const { result, setToast, onSwitchStart, queue } = render();
      await flush();

      await act(async () => { await result.current.handleModelSwitch('org/model-b'); });

      const post = fetchMock.mock.calls.find(([url, init]) => url === `${API}/models/switch` && init?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post[1].body)).toEqual({ model_name: 'org/model-b', clear_queue: false });
      expect(onSwitchStart).toHaveBeenCalledTimes(1);
      expect(result.current.models).toEqual(switched);
      expect(result.current.pendingModel).toBe('org/model-b');
      expect(result.current.modelLoadError).toBeNull();
      expect(result.current.isSwitchingModel).toBe(false);
      expect(setToast).toHaveBeenCalledWith({ message: 'Successfully activated model-b', type: 'success' });
      expect(queue.fetchQueue).toHaveBeenCalledTimes(1);
    });

    it('executeModelSwitch sends clear_queue and closes the warning', async () => {
      const fetchMock = setupFetch({
        [`POST ${API}/models/switch`]: async () => ({ ok: true, json: async () => ({}) }),
      });
      const { result } = render({ queue: makeQueue({ pendingCount: 1 }) });
      await flush();

      await act(async () => { await result.current.handleModelSwitch('org/model-b'); });
      expect(result.current.modelSwitchWarning.isOpen).toBe(true);

      await act(async () => { await result.current.executeModelSwitch('org/model-b', true); });
      const post = fetchMock.mock.calls.find(([url, init]) => url === `${API}/models/switch` && init?.method === 'POST');
      expect(JSON.parse(post[1].body)).toEqual({ model_name: 'org/model-b', clear_queue: true });
      expect(result.current.modelSwitchWarning.isOpen).toBe(false);
    });

    it('reports a failed switch with a toast and modelLoadError', async () => {
      setupFetch({
        [`POST ${API}/models/switch`]: async () => ({
          ok: false,
          statusText: 'Server Error',
          json: async () => ({ detail: 'Out of memory' }),
        }),
      });
      const { result, setToast, onSwitchStart, queue } = render();
      await flush();

      await act(async () => { await result.current.handleModelSwitch('org/model-b'); });

      expect(onSwitchStart).toHaveBeenCalledTimes(1);
      expect(setToast).toHaveBeenCalledWith({ message: 'Model load error: Out of memory', type: 'error' });
      expect(result.current.modelLoadError).toEqual({ model: 'org/model-b', message: 'Out of memory' });
      expect(result.current.pendingModel).not.toBe('org/model-b');
      expect(queue.fetchQueue).not.toHaveBeenCalled();
      expect(result.current.isSwitchingModel).toBe(false);
    });
  });

  describe('download completion toast', () => {
    it('toasts success when is_downloading goes true -> false with bytes and no error', async () => {
      setupFetch();
      const downloading = { is_downloading: true, download_total_bytes: 1000, download_error: null };
      const { rerender, setToast, setStatus, queue } = render({ status: downloading });
      await flush();
      expect(setToast).not.toHaveBeenCalled();

      rerender({
        status: { ...downloading, is_downloading: false }, setStatus, queue, setToast, onSwitchStart: vi.fn(),
      });
      await flush();

      // pendingModel defaults to siglip2-base, which is not the active model in the stub.
      expect(setToast).toHaveBeenCalledWith({
        message: 'Model siglip2-base-patch16-224 downloaded successfully.',
        type: 'success',
      });
    });

    it('does not toast success when there was a download error, and toasts the failure once', async () => {
      setupFetch();
      const downloading = { is_downloading: true, download_total_bytes: 1000, download_error: null };
      const { rerender, setToast, setStatus, queue, result } = render({ status: downloading });
      await flush();

      const failed = { is_downloading: false, download_total_bytes: 1000, download_error: 'disk full' };
      rerender({ status: failed, setStatus, queue, setToast, onSwitchStart: vi.fn() });
      await flush();
      rerender({ status: { ...failed }, setStatus, queue, setToast, onSwitchStart: vi.fn() });
      await flush();

      const messages = setToast.mock.calls.map(([t]) => t.message);
      expect(messages).toEqual(['Download failed: disk full']);
      expect(result.current.modelLoadError).toEqual({
        model: 'google/siglip2-base-patch16-224',
        message: 'disk full',
      });
    });

    it('does not toast when no bytes were downloaded', async () => {
      setupFetch();
      const downloading = { is_downloading: true, download_total_bytes: 0, download_error: null };
      const { rerender, setToast, setStatus, queue } = render({ status: downloading });
      await flush();
      rerender({ status: { ...downloading, is_downloading: false }, setStatus, queue, setToast, onSwitchStart: vi.fn() });
      await flush();
      expect(setToast).not.toHaveBeenCalled();
    });
  });

  describe('poll state identity', () => {
    const fresh = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });
    const setupFreshFetch = () => {
      const payloads = { models: modelsPayload, gpu: gpuPayload };
      const fetchMock = vi.fn(async (url) => {
        if (url === `${API}/models`) return fresh(payloads.models);
        if (url === `${API}/settings/gpu`) return fresh(payloads.gpu);
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      return payloads;
    };

    it('keeps models and gpuSettings references across polls with equal payloads', async () => {
      setupFreshFetch();
      const { result } = render();
      await flush();
      const { models, gpuSettings } = result.current;
      expect(models).toEqual(modelsPayload);
      expect(gpuSettings).toEqual(gpuPayload);

      await tick(1500);
      await tick(1500);
      expect(result.current.models).toBe(models);
      expect(result.current.gpuSettings).toBe(gpuSettings);
    });

    it('returns new references with the new data when the payloads change', async () => {
      const payloads = setupFreshFetch();
      const { result } = render();
      await flush();
      const { models, gpuSettings } = result.current;

      payloads.models = { active_model: 'org/model-b', models: [{ name: 'org/model-b' }] };
      payloads.gpu = { ...gpuPayload, use_gpu: true };
      await tick(1500);
      expect(result.current.models).not.toBe(models);
      expect(result.current.models.active_model).toBe('org/model-b');
      expect(result.current.gpuSettings).not.toBe(gpuSettings);
      expect(result.current.gpuSettings.use_gpu).toBe(true);
    });

    it('keeps the models reference when the post-download refresh returns an equal payload', async () => {
      setupFreshFetch();
      const { result, rerender, setStatus, setToast, queue } = render({ status: { ...idleStatus, is_downloading: true } });
      await flush();
      const models = result.current.models;

      rerender({ status: idleStatus, setStatus, queue, setToast, onSwitchStart: vi.fn() });
      await flush();
      expect(result.current.models).toBe(models);
    });
  });
});
