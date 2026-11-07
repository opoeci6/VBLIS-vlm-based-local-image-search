import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPathForFile, isDirectory } from './electron';

describe('electron helpers', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  describe('getPathForFile', () => {
    it('uses electronAPI.getPathForFile when available', () => {
      const getPath = vi.fn().mockReturnValue('C:\\abs\\a.png');
      window.electronAPI = { getPathForFile: getPath };
      const file = { path: 'ignored' };
      expect(getPathForFile(file)).toBe('C:\\abs\\a.png');
      expect(getPath).toHaveBeenCalledWith(file);
    });

    it('falls back to file.path without electronAPI', () => {
      expect(getPathForFile({ path: '/tmp/a.png' })).toBe('/tmp/a.png');
    });

    it('falls back to file.path when electronAPI lacks the method', () => {
      window.electronAPI = {};
      expect(getPathForFile({ path: '/tmp/a.png' })).toBe('/tmp/a.png');
    });
  });

  describe('isDirectory', () => {
    it('delegates to electronAPI.isDirectory', async () => {
      const isDir = vi.fn().mockResolvedValue(true);
      window.electronAPI = { isDirectory: isDir };
      await expect(isDirectory('/some/dir')).resolves.toBe(true);
      expect(isDir).toHaveBeenCalledWith('/some/dir');
    });

    it('returns false without electronAPI instead of throwing', async () => {
      await expect(isDirectory('/some/dir')).resolves.toBe(false);
    });

    it('returns false when electronAPI lacks the method', async () => {
      window.electronAPI = {};
      await expect(isDirectory('/some/dir')).resolves.toBe(false);
    });
  });
});
