import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useIndexedFolders } from './useIndexedFolders';

const API = 'http://127.0.0.1:8000';

const foldersPayload = {
  folders: [
    { path: '/a', subfolders: [{ path: '/a/x' }] },
    { path: '/b' },
  ],
};

const jsonResponse = (body, ok = true) => ({ ok, statusText: ok ? 'OK' : 'Error', json: async () => body });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useIndexedFolders', () => {
  let fetchMock;
  let routes;
  let setToast;
  let onIndexChanged;

  const listCalls = () => fetchMock.mock.calls.filter(([url, init]) => url === `${API}/index/folders` && !init);

  const baseProps = () => ({
    activeModel: 'org/model-a',
    lastTaskId: 0,
    isExpanded: false,
    setToast,
    onIndexChanged,
  });

  const render = (overrides = {}) => {
    const initialProps = { ...baseProps(), ...overrides };
    return renderHook((p) => useIndexedFolders(p), { initialProps });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setToast = vi.fn();
    onIndexChanged = vi.fn();
    routes = {};
    fetchMock = vi.fn(async (url, init) => {
      const key = `${init?.method || 'GET'} ${url}`;
      if (routes[key]) return routes[key](url, init);
      if (key === `GET ${API}/index/folders`) return jsonResponse(foldersPayload);
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

  describe('fetching', () => {
    it('fetches once on mount with an active model, non-silently', async () => {
      let release;
      routes[`GET ${API}/index/folders`] = () => new Promise((resolve) => {
        release = () => resolve(jsonResponse(foldersPayload));
      });
      const { result } = render();
      await flush();
      expect(listCalls()).toHaveLength(1);
      expect(result.current.isFetchingFolders).toBe(true);

      await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.isFetchingFolders).toBe(false);
      expect(result.current.indexedFolders).toEqual(foldersPayload.folders);
    });

    it('does not fetch without an active model', async () => {
      render({ activeModel: '' });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refetches when lastTaskId changes', async () => {
      const { rerender } = render();
      await flush();
      expect(listCalls()).toHaveLength(1);
      rerender({ ...baseProps(), lastTaskId: 1 });
      await flush();
      expect(listCalls()).toHaveLength(2);
    });

    it('does not make extra requests when re-rendered with identical props', async () => {
      const props = baseProps();
      const { rerender } = render();
      await flush();
      const before = fetchMock.mock.calls.length;
      for (let i = 0; i < 4; i++) rerender({ ...props });
      await flush();
      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it('silently refetches when expanded and polls every 8 s until collapsed', async () => {
      const { rerender, result } = render();
      await flush();
      expect(listCalls()).toHaveLength(1);

      rerender({ ...baseProps(), isExpanded: true });
      await flush();
      expect(listCalls()).toHaveLength(2);
      expect(result.current.isFetchingFolders).toBe(false);

      await tick(7999);
      expect(listCalls()).toHaveLength(2);
      await tick(1);
      expect(listCalls()).toHaveLength(3);
      await tick(8000);
      expect(listCalls()).toHaveLength(4);

      rerender({ ...baseProps(), isExpanded: false });
      await flush();
      const calls = listCalls().length;
      await tick(30000);
      expect(listCalls()).toHaveLength(calls);
    });

    it('does not poll while expanded without an active model', async () => {
      render({ activeModel: '', isExpanded: true });
      await tick(20000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('silently refetches on window focus', async () => {
      const { result } = render();
      await flush();
      expect(listCalls()).toHaveLength(1);

      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(listCalls()).toHaveLength(2);
      expect(result.current.isFetchingFolders).toBe(false);
    });

    it('removes the focus listener on unmount', async () => {
      const { unmount } = render();
      await flush();
      unmount();
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(listCalls()).toHaveLength(1);
    });
  });

  describe('selection', () => {
    it('toggleSelectAll selects everything, then clears', async () => {
      const { result } = render();
      await flush();
      expect(result.current.allSelectableFolderPaths).toEqual(['/a', '/a/x', '/b']);

      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedFolders).toEqual(['/a', '/a/x', '/b']);
      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedFolders).toEqual([]);
    });

    it('toggleFolderSelection selects a root together with its subfolders', async () => {
      const { result } = render();
      await flush();
      act(() => result.current.toggleFolderSelection('/a', false, foldersPayload.folders[0]));
      expect(result.current.selectedFolders.sort()).toEqual(['/a', '/a/x']);
    });

    it('clears the selection when the active model changes', async () => {
      const { result, rerender } = render();
      await flush();
      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedFolders).toHaveLength(3);

      rerender({ ...baseProps(), activeModel: 'org/model-b' });
      await flush();
      expect(result.current.selectedFolders).toEqual([]);
    });
  });

  describe('handlers', () => {
    it('handleDeleteFolderIndex removes the folder, updates selection, refetches and notifies', async () => {
      routes[`POST ${API}/index/folder/delete`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      act(() => result.current.toggleSelectAll());
      const listBefore = listCalls().length;

      await act(async () => { await result.current.handleDeleteFolderIndex('/b'); });
      await flush();

      const post = fetchMock.mock.calls.find(([url, init]) => url === `${API}/index/folder/delete` && init?.method === 'POST');
      expect(JSON.parse(post[1].body)).toEqual({ folder_path: '/b' });
      expect(setToast).toHaveBeenCalledWith({ message: 'Folder index removed successfully.', type: 'success' });
      expect(result.current.selectedFolders).toEqual(['/a', '/a/x']);
      expect(listCalls().length).toBe(listBefore + 1);
      expect(onIndexChanged).toHaveBeenCalledTimes(1);
    });

    it('handleDeleteFolderIndex reports an API error without notifying', async () => {
      routes[`POST ${API}/index/folder/delete`] = async () => jsonResponse({ detail: 'nope' }, false);
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleDeleteFolderIndex('/b'); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Error: nope', type: 'error' });
      expect(onIndexChanged).not.toHaveBeenCalled();
    });

    it('handleBatchDelete POSTs the selection, clears it and notifies', async () => {
      routes[`POST ${API}/index/folders/batch-delete`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      act(() => result.current.toggleSelectAll());

      await act(async () => { await result.current.handleBatchDelete(); });
      await flush();

      const post = fetchMock.mock.calls.find(([url]) => url === `${API}/index/folders/batch-delete`);
      expect(JSON.parse(post[1].body)).toEqual({ folder_paths: ['/a', '/a/x', '/b'] });
      expect(setToast).toHaveBeenCalledWith({ message: 'Successfully removed 3 folders.', type: 'success' });
      expect(result.current.selectedFolders).toEqual([]);
      expect(result.current.isBatchProcessing).toBe(false);
      expect(onIndexChanged).toHaveBeenCalledTimes(1);
    });

    it('handleBatchDelete does nothing with an empty selection', async () => {
      const { result } = render();
      await flush();
      const before = fetchMock.mock.calls.length;
      await act(async () => { await result.current.handleBatchDelete(); });
      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it('handleBatchReindex POSTs and clears without notifying', async () => {
      routes[`POST ${API}/index/folders/batch-reindex`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      act(() => result.current.toggleSelectAll());

      await act(async () => { await result.current.handleBatchReindex(); });

      const post = fetchMock.mock.calls.find(([url]) => url === `${API}/index/folders/batch-reindex`);
      expect(JSON.parse(post[1].body)).toEqual({ folder_paths: ['/a', '/a/x', '/b'] });
      expect(setToast).toHaveBeenCalledWith({ message: 'Re-indexing started for 3 folders.', type: 'success' });
      expect(result.current.selectedFolders).toEqual([]);
      expect(onIndexChanged).not.toHaveBeenCalled();
    });

    it('handleReindexFolder toasts success', async () => {
      routes[`POST ${API}/index/folder/reindex`] = async () => jsonResponse({});
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleReindexFolder('/a'); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Re-indexing started in background.', type: 'success' });
    });

    it.each(['Invalid directory path', 'Folder does not exist'])(
      'handleReindexFolder maps "%s" to the not-accessible toast and silently refetches',
      async (detail) => {
        routes[`POST ${API}/index/folder/reindex`] = async () => jsonResponse({ detail }, false);
        const { result } = render();
        await flush();
        const before = listCalls().length;

        await act(async () => { await result.current.handleReindexFolder('/a'); });
        await flush();

        expect(setToast).toHaveBeenCalledWith({
          message: 'Folder is still not accessible on disk. Please reconnect the drive and try again.',
          type: 'error',
        });
        expect(listCalls().length).toBe(before + 1);
        expect(result.current.isFetchingFolders).toBe(false);
      }
    );

    it('handleReindexFolder shows other API errors verbatim', async () => {
      routes[`POST ${API}/index/folder/reindex`] = async () => jsonResponse({ detail: 'busy' }, false);
      const { result } = render();
      await flush();
      await act(async () => { await result.current.handleReindexFolder('/a'); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Error: busy', type: 'error' });
    });
  });
});
