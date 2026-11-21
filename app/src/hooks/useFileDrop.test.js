import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useFileDrop } from './useFileDrop';
import { SessionProvider } from '../session/SessionProvider';

const makeEvent = ({ types = ['Files'], files = [] } = {}) => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  dataTransfer: { types, files },
});

const folderFile = { path: '/data/photos', type: '' };
const imageFile = { path: '/data/cat.png', type: 'image/png' };
const textFile = { path: '/data/notes.txt', type: 'text/plain' };

describe('useFileDrop', () => {
  let setToast;
  let onFolders;
  let onImage;

  beforeEach(() => {
    setToast = vi.fn();
    onFolders = vi.fn().mockResolvedValue(undefined);
    onImage = vi.fn();
    window.electronAPI = {
      getPathForFile: (file) => file.path,
      isDirectory: vi.fn(async (p) => p === '/data/photos'),
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  const render = (enabled = true) =>
    renderHook(() => useFileDrop({ enabled, setToast, onFolders, onImage }));

  describe('drag state', () => {
    it('shows the overlay on dragover with Files when enabled', () => {
      const { result } = render(true);
      const event = makeEvent();
      act(() => result.current.handleDragOver(event));
      expect(result.current.isDragging).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('ignores dragover when disabled', () => {
      const { result } = render(false);
      act(() => result.current.handleDragOver(makeEvent()));
      expect(result.current.isDragging).toBe(false);
    });

    it('ignores dragover that does not carry Files', () => {
      const { result } = render(true);
      act(() => result.current.handleDragOver(makeEvent({ types: ['text/plain'] })));
      expect(result.current.isDragging).toBe(false);
    });

    it('resets on dragleave', () => {
      const { result } = render(true);
      act(() => result.current.handleDragOver(makeEvent()));
      const leave = makeEvent();
      act(() => result.current.handleDragLeave(leave));
      expect(result.current.isDragging).toBe(false);
      expect(leave.preventDefault).toHaveBeenCalled();
    });
  });

  describe('on a read-only copy', () => {
    const renderReadOnly = () => renderHook(() => useFileDrop({ enabled: true, setToast, onFolders, onImage, readOnly: true }));

    it('does not queue a dropped folder, and says why', async () => {
      const { result } = renderReadOnly();
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folderFile] })); });
      expect(onFolders).not.toHaveBeenCalled();
      expect(setToast).toHaveBeenCalledWith({
        message: 'This library is a read-only copy; indexing happens on another computer.',
        type: 'info',
      });
    });

    it('still searches with a dropped image, also when a folder came along', async () => {
      const { result } = renderReadOnly();
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folderFile, imageFile] })); });
      expect(onFolders).not.toHaveBeenCalled();
      expect(onImage).toHaveBeenCalledWith(imageFile);
      expect(setToast).not.toHaveBeenCalled();
    });
  });

  describe('drop', () => {
    it('is a no-op for an empty file list', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [] })); });
      expect(setToast).not.toHaveBeenCalled();
      expect(onFolders).not.toHaveBeenCalled();
      expect(onImage).not.toHaveBeenCalled();
    });

    it('toasts and does nothing when no model is available', async () => {
      const { result } = render(false);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folderFile] })); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Please select or download a model first.', type: 'error' });
      expect(onFolders).not.toHaveBeenCalled();
    });

    it('clears the drag overlay on drop', async () => {
      const { result } = render(true);
      act(() => result.current.handleDragOver(makeEvent()));
      expect(result.current.isDragging).toBe(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [] })); });
      expect(result.current.isDragging).toBe(false);
    });

    it('sends dropped directories to onFolders', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folderFile] })); });
      expect(onFolders).toHaveBeenCalledWith(['/data/photos']);
      expect(onImage).not.toHaveBeenCalled();
    });

    it('prefers folders over images when both are dropped', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [imageFile, folderFile] })); });
      expect(onFolders).toHaveBeenCalledWith(['/data/photos']);
      expect(onImage).not.toHaveBeenCalled();
    });

    it('sends the first image file to onImage', async () => {
      const { result } = render(true);
      const second = { path: '/data/dog.png', type: 'image/png' };
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [imageFile, second] })); });
      expect(onImage).toHaveBeenCalledTimes(1);
      expect(onImage).toHaveBeenCalledWith(imageFile);
      expect(onFolders).not.toHaveBeenCalled();
    });

    it('toasts for anything else', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [textFile] })); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Please drop a folder or an image file.', type: 'error' });
      expect(onFolders).not.toHaveBeenCalled();
      expect(onImage).not.toHaveBeenCalled();
    });

    it('skips non-image files without a resolvable path', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [{ path: '', type: '' }] })); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Please drop a folder or an image file.', type: 'error' });
    });

    it('searches with an image whose path is unknown, without looking the path up', async () => {
      const { result } = render(true);
      const noPath = { path: '', type: 'image/png' };
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [noPath] })); });
      expect(onImage).toHaveBeenCalledWith(noPath);
      expect(window.electronAPI.isDirectory).not.toHaveBeenCalled();
      expect(setToast).not.toHaveBeenCalled();
    });

    it('treats files as non-directories outside Electron', async () => {
      delete window.electronAPI;
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [imageFile] })); });
      expect(onImage).toHaveBeenCalledWith(imageFile);
    });
  });

  describe('in a browser (network session)', () => {
    const sessionInfo = (role, imageSearch = true) => ({
      signed_in: true,
      role,
      account: { id: 'a1', name: 'alice' },
      permissions: { originals: role === 'owner', image_search: imageSearch, places: true },
      secure: true,
      case_sensitive_paths: true,
    });

    const renderIn = (info) => renderHook(
      () => useFileDrop({ enabled: true, setToast, onFolders, onImage }),
      { wrapper: ({ children }) => createElement(SessionProvider, { info, onSignOut: vi.fn() }, children) },
    );

    // A browser file has no path.
    const pic = { type: 'image/png', name: 'cat.png' };
    const folder = { type: '', name: 'photos' };

    beforeEach(() => {
      delete window.electronAPI;
    });

    it('searches with a dropped image for an owner', async () => {
      const { result } = renderIn(sessionInfo('owner'));
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [pic] })); });
      expect(onImage).toHaveBeenCalledWith(pic);
      expect(setToast).not.toHaveBeenCalled();
    });

    it('points an owner who drops a folder at the Add Folder(s) button', async () => {
      const { result } = renderIn(sessionInfo('owner'));
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folder] })); });
      expect(setToast).toHaveBeenCalledWith({
        message: "Folders can't be dropped into a browser. Use the Add Folder(s) button instead.",
        type: 'info',
      });
      expect(onFolders).not.toHaveBeenCalled();
      expect(onImage).not.toHaveBeenCalled();
    });

    it('lets a viewer with image search drop an image but ignores a dropped folder', async () => {
      const { result } = renderIn(sessionInfo('viewer'));
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [pic] })); });
      expect(onImage).toHaveBeenCalledWith(pic);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [folder] })); });
      expect(setToast).not.toHaveBeenCalled();
      expect(onFolders).not.toHaveBeenCalled();
    });

    it('offers a viewer without image search nothing: no overlay, no search, no toast', async () => {
      const { result } = renderIn(sessionInfo('viewer', false));
      act(() => result.current.handleDragOver(makeEvent()));
      expect(result.current.isDragging).toBe(false);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [pic] })); });
      expect(onImage).not.toHaveBeenCalled();
      expect(setToast).not.toHaveBeenCalled();
    });

    it('shows the overlay for a viewer who may search by image', () => {
      const { result } = renderIn(sessionInfo('viewer'));
      act(() => result.current.handleDragOver(makeEvent()));
      expect(result.current.isDragging).toBe(true);
    });
  });
});
