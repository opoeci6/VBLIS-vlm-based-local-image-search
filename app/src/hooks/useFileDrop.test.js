import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFileDrop } from './useFileDrop';

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

    it('skips files without a resolvable path', async () => {
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [{ path: '', type: 'image/png' }] })); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Please drop a folder or an image file.', type: 'error' });
    });

    it('treats files as non-directories outside Electron', async () => {
      delete window.electronAPI;
      const { result } = render(true);
      await act(async () => { await result.current.handleDrop(makeEvent({ files: [imageFile] })); });
      expect(onImage).toHaveBeenCalledWith(imageFile);
    });
  });
});
