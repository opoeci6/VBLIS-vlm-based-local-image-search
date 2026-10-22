import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFolderContents } from './useFolderContents';

const API = 'http://127.0.0.1:8000';

const folder = { path: '/photos', name: 'photos' };
const contentsPayload = { items: [{ path: '/photos/a.jpg' }], total: 1 };

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useFolderContents', () => {
  let fetchMock;
  let respond;
  let setToast;
  let refreshFolders;

  const contentCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`${API}/index/folder/contents`));

  const baseProps = () => ({ activeModel: 'org/model-a', lastTaskId: 0, setToast, refreshFolders });

  const render = (overrides = {}) =>
    renderHook((p) => useFolderContents(p), { initialProps: { ...baseProps(), ...overrides } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setToast = vi.fn();
    refreshFolders = vi.fn();
    respond = () => jsonResponse(contentsPayload);
    fetchMock = vi.fn(async () => respond());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('handleBrowseFolderContents', () => {
    it('opens the modal and loads the folder contents', async () => {
      const { result } = render();
      await act(async () => { await result.current.handleBrowseFolderContents(folder); });

      expect(result.current.showFolderContents).toBe(true);
      expect(result.current.browsingFolder).toBe(folder);
      expect(result.current.folderVisibleLimit).toBe(60);
      expect(result.current.folderContents).toEqual(contentsPayload);
      expect(result.current.isFetchingFolderContents).toBe(false);

      expect(contentCalls()).toHaveLength(1);
      const url = new URL(contentCalls()[0][0]);
      expect(url.searchParams.get('folder_path')).toBe('/photos');
    });

    it('shows the loading flag and clears stale contents while fetching', async () => {
      let release;
      respond = () => new Promise((resolve) => { release = () => resolve(jsonResponse(contentsPayload)); });
      const { result } = render();
      act(() => { result.current.handleBrowseFolderContents(folder); });
      expect(result.current.isFetchingFolderContents).toBe(true);
      expect(result.current.folderContents).toBeNull();

      await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.isFetchingFolderContents).toBe(false);
    });

    it('ignores a missing folder', async () => {
      const { result } = render();
      await act(async () => { await result.current.handleBrowseFolderContents(null); });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.showFolderContents).toBe(false);
    });

    it('toasts, closes the modal and refreshes folders on a non-ok response', async () => {
      respond = () => jsonResponse({ detail: 'Folder is gone' }, false);
      const { result } = render();
      await act(async () => { await result.current.handleBrowseFolderContents(folder); });

      expect(setToast).toHaveBeenCalledWith({ message: 'Folder is gone', type: 'error' });
      expect(result.current.showFolderContents).toBe(false);
      expect(result.current.browsingFolder).toBeNull();
      expect(result.current.isFetchingFolderContents).toBe(false);
      expect(refreshFolders).toHaveBeenCalledWith(true);
    });

    it('does not toast or close in silent mode, but still refreshes folders', async () => {
      const { result } = render();
      await act(async () => { await result.current.handleBrowseFolderContents(folder); });
      respond = () => jsonResponse({ detail: 'boom' }, false);
      setToast.mockClear();

      await act(async () => { await result.current.handleBrowseFolderContents(folder, true); });
      expect(setToast).not.toHaveBeenCalled();
      expect(result.current.showFolderContents).toBe(true);
      expect(refreshFolders).toHaveBeenCalledWith(true);
    });

    it('handleCloseFolderContents resets the state', async () => {
      const { result } = render();
      await act(async () => { await result.current.handleBrowseFolderContents(folder); });
      act(() => result.current.setFolderVisibleLimit(120));

      act(() => result.current.handleCloseFolderContents());
      expect(result.current.showFolderContents).toBe(false);
      expect(result.current.browsingFolder).toBeNull();
      expect(result.current.folderContents).toBeNull();
      expect(result.current.folderVisibleLimit).toBe(60);
    });
  });

  describe('live refresh while open', () => {
    const open = async (hook) => {
      await act(async () => { await hook.result.current.handleBrowseFolderContents(folder); });
      await flush();
    };

    it('does not trigger an extra fetch beyond the explicit one when opening', async () => {
      const hook = render();
      await open(hook);
      expect(contentCalls()).toHaveLength(1);
    });

    it('does not make extra requests when re-rendered with identical props', async () => {
      const hook = render();
      await open(hook);
      for (let i = 0; i < 4; i++) hook.rerender({ ...baseProps() });
      await flush();
      expect(contentCalls()).toHaveLength(1);
    });

    it('polls every 10 s while open and stops after closing', async () => {
      const hook = render();
      await open(hook);

      await tick(9999);
      expect(contentCalls()).toHaveLength(1);
      await tick(1);
      expect(contentCalls()).toHaveLength(2);
      await tick(10000);
      expect(contentCalls()).toHaveLength(3);

      act(() => hook.result.current.handleCloseFolderContents());
      await tick(60000);
      expect(contentCalls()).toHaveLength(3);
    });

    it('silently refreshes when lastTaskId changes while open', async () => {
      const hook = render();
      await open(hook);
      hook.rerender({ ...baseProps(), lastTaskId: 5 });
      await flush();
      expect(contentCalls()).toHaveLength(2);
      expect(hook.result.current.isFetchingFolderContents).toBe(false);
    });

    it('does not fetch on lastTaskId change while closed', async () => {
      const hook = render();
      await flush();
      hook.rerender({ ...baseProps(), lastTaskId: 5 });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes the open modal on window focus, and not when closed', async () => {
      const hook = render();
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(contentCalls()).toHaveLength(0);

      await open(hook);
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(contentCalls()).toHaveLength(2);
    });

    it('does nothing without an active model', async () => {
      const hook = render({ activeModel: '' });
      await open(hook);
      expect(contentCalls()).toHaveLength(1);
      await tick(30000);
      hook.rerender({ ...baseProps(), activeModel: '', lastTaskId: 3 });
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(contentCalls()).toHaveLength(1);
    });
  });
});
