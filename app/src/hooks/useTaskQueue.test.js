import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTaskQueue } from './useTaskQueue';

const API = 'http://127.0.0.1:8000';

const taskA = { id: 'a', title: 'Index A', status: 'pending' };
const taskB = { id: 'b', title: 'Index B', status: 'pending' };

const basePayload = () => ({
  active_task: { id: 'run', title: 'Running', status: 'running', processed_count: 3 },
  pending_tasks: [taskA, taskB],
  history: [{ id: 'old', title: 'Old', status: 'completed' }],
  worker_state: 'running',
  pending_count: 2,
  history_count: 1,
  model_mismatch: { is_mismatch: true, queued_model: 'm1', active_model: 'm2', reason: 'differs' },
  active_model: 'm2',
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useTaskQueue', () => {
  let payload;
  let reorderOk;
  let enqueueResponse;
  let fetchMock;
  let setToast;

  beforeEach(() => {
    vi.useFakeTimers();
    setToast = vi.fn(); // stable across renders, like the useState setter App passes
    payload = basePayload();
    reorderOk = true;
    // Fresh deep copy per response, like a real network body.
    fetchMock = vi.fn(async (url, init) => {
      if (url === `${API}/queue` && !init) return { ok: true, json: async () => JSON.parse(JSON.stringify(payload)) };
      if (url === `${API}/queue/reorder` && init?.method === 'POST') return { ok: reorderOk, json: async () => ({}) };
      if (url === `${API}/queue/enqueue` && init?.method === 'POST') return { ok: true, json: async () => JSON.parse(JSON.stringify(enqueueResponse)) };
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('polls /queue immediately and every 1200 ms', async () => {
    renderHook(() => useTaskQueue(API, setToast));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exposes the polled queue data', async () => {
    const { result } = renderHook(() => useTaskQueue(API, setToast));
    await flush();
    expect(result.current.activeTask).toEqual(payload.active_task);
    expect(result.current.pendingTasks).toEqual([taskA, taskB]);
    expect(result.current.history).toEqual(payload.history);
    expect(result.current.modelMismatch).toMatchObject({ isMismatch: true, queuedModel: 'm1', activeModel: 'm2', reason: 'differs' });
    expect(result.current.activeModel).toBe('m2');
  });

  describe('poll state identity', () => {
    it('keeps activeTask, pendingTasks, history and modelMismatch references across equal polls', async () => {
      const { result } = renderHook(() => useTaskQueue(API, setToast));
      await flush();
      const { activeTask, pendingTasks, history, modelMismatch } = result.current;
      expect(activeTask).not.toBeNull();
      expect(modelMismatch).not.toBeNull();

      await tick(1200);
      await tick(1200);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.current.activeTask).toBe(activeTask);
      expect(result.current.pendingTasks).toBe(pendingTasks);
      expect(result.current.history).toBe(history);
      expect(result.current.modelMismatch).toBe(modelMismatch);
    });

    it('keeps the empty fallbacks stable when the server omits lists', async () => {
      payload = { active_task: null, worker_state: 'running' };
      const { result } = renderHook(() => useTaskQueue(API, setToast));
      await flush();
      const { pendingTasks, history } = result.current;
      await tick(1200);
      expect(result.current.pendingTasks).toBe(pendingTasks);
      expect(result.current.history).toBe(history);
      expect(result.current.activeTask).toBeNull();
      expect(result.current.modelMismatch).toBeNull();
    });

    it('returns new references with the new data when the payload changes', async () => {
      const { result } = renderHook(() => useTaskQueue(API, setToast));
      await flush();
      const { activeTask, pendingTasks, history, modelMismatch } = result.current;

      payload = {
        ...basePayload(),
        active_task: { id: 'run', title: 'Running', status: 'running', processed_count: 4 },
        pending_tasks: [taskB],
        history: [{ id: 'run', title: 'Running', status: 'completed' }, ...basePayload().history],
        model_mismatch: null,
      };
      await tick(1200);
      expect(result.current.activeTask).not.toBe(activeTask);
      expect(result.current.activeTask.processed_count).toBe(4);
      expect(result.current.pendingTasks).not.toBe(pendingTasks);
      expect(result.current.pendingTasks).toEqual([taskB]);
      expect(result.current.history).not.toBe(history);
      expect(result.current.history).toHaveLength(2);
      expect(result.current.modelMismatch).not.toBe(modelMismatch);
      expect(result.current.modelMismatch).toBeNull();
    });

    it('compares against the current state so a failed optimistic reorder is restored by the refetch', async () => {
      const { result } = renderHook(() => useTaskQueue(API, setToast));
      await flush();
      expect(result.current.pendingTasks.map(t => t.id)).toEqual(['a', 'b']);

      reorderOk = false;
      await act(async () => { await result.current.reorderTasks([taskB, taskA]); });

      expect(fetchMock.mock.calls.some(([url]) => url === `${API}/queue/reorder`)).toBe(true);
      expect(result.current.pendingTasks.map(t => t.id)).toEqual(['a', 'b']);
    });
  });

  describe('enqueueFolderIndexing toasts', () => {
    const enqueue = async (folders, response) => {
      enqueueResponse = response;
      const { result } = renderHook(() => useTaskQueue(API, setToast));
      await flush();
      await act(async () => { await result.current.enqueueFolderIndexing(folders); });
    };

    // The wording is built from the counts, not taken from the backend's English `message`.
    it('says how many tasks were enqueued', async () => {
      await enqueue(['/a'], { tasks: [taskA], duplicates: [], message: 'Enqueued 1 task(s).' });
      expect(setToast).toHaveBeenCalledWith({ message: 'Enqueued 1 task.', type: 'success' });
    });

    it('uses the plural for several tasks', async () => {
      await enqueue(['/a', '/b'], { tasks: [taskA, taskB], duplicates: [] });
      expect(setToast).toHaveBeenCalledWith({ message: 'Enqueued 2 tasks.', type: 'success' });
    });

    it('adds how many duplicates were skipped', async () => {
      await enqueue(['/a', '/b'], { tasks: [taskA], duplicates: [{ path: '/b' }] });
      expect(setToast).toHaveBeenCalledWith({ message: 'Enqueued 1 task(s). (1 duplicate(s) skipped)', type: 'success' });
    });

    it('tells when the folder is already queued', async () => {
      await enqueue(['/b'], { tasks: [], duplicates: [{ path: '/b' }] });
      expect(setToast).toHaveBeenCalledWith({ message: 'Folder is already in the queue: /b', type: 'info' });
    });

    it('falls back to the number of folders when the response has no task list', async () => {
      await enqueue(['/a', '/b'], { status: 'queued' });
      expect(setToast).toHaveBeenCalledWith({ message: 'Added 2 folders to queue.', type: 'success' });
      setToast.mockClear();
      cleanup();
      await enqueue(['/a'], {});
      expect(setToast).toHaveBeenCalledWith({ message: 'Added 1 folder to queue.', type: 'success' });
    });
  });

  describe('completion toast', () => {
    it('toasts once when the active task moves to history as completed', async () => {
      renderHook(() => useTaskQueue(API, setToast));
      await flush();
      expect(setToast).not.toHaveBeenCalled();

      payload = {
        ...basePayload(),
        active_task: null,
        history: [{ id: 'run', title: 'Running', status: 'completed', processed_count: 9 }],
      };
      await tick(1200);
      expect(setToast).toHaveBeenCalledTimes(1);
      expect(setToast).toHaveBeenCalledWith({ message: 'Task completed: Running (9 items)', type: 'success' });
      await tick(1200);
      expect(setToast).toHaveBeenCalledTimes(1);
    });

    it('says "1 item" for a single item and titles a known task type', async () => {
      renderHook(() => useTaskQueue(API, setToast));
      await flush();
      payload = {
        ...basePayload(),
        active_task: null,
        history: [{ id: 'run', type: 'INDEX_FOLDERS', title: 'Index: Photos', status: 'completed', processed_count: 1 }],
      };
      await tick(1200);
      expect(setToast).toHaveBeenCalledWith({ message: 'Task completed: Index: Photos (1 item)', type: 'success' });
    });

    it('toasts a failed task by its title', async () => {
      renderHook(() => useTaskQueue(API, setToast));
      await flush();
      payload = { ...basePayload(), active_task: null, history: [{ id: 'run', title: 'Running', status: 'failed' }] };
      await tick(1200);
      expect(setToast).toHaveBeenCalledWith({ message: 'Task failed: Running', type: 'error' });
    });
  });
});
