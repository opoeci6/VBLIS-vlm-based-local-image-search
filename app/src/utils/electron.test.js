import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { copyText, getPathForFile, isDirectory, openInExplorer, translateElectronError } from './electron';

describe('electron helpers', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  describe('copyText', () => {
    it('copies through electronAPI.copyText', async () => {
      const copy = vi.fn().mockResolvedValue({ success: true });
      window.electronAPI = { copyText: copy };
      await expect(copyText('/pics/a.jpg')).resolves.toEqual({ success: true });
      expect(copy).toHaveBeenCalledWith('/pics/a.jpg');
    });

    it('passes on a failure reported by the main process', async () => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: false, error: 'Nothing to copy.' }) };
      await expect(copyText('')).resolves.toEqual({ success: false, error: 'Nothing to copy.' });
    });

    it('falls back to navigator.clipboard without electronAPI', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      await expect(copyText('hello')).resolves.toEqual({ success: true });
      expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('reports that the clipboard is unavailable', async () => {
      vi.stubGlobal('navigator', {});
      await expect(copyText('hello')).resolves.toEqual({ success: false, error: 'Clipboard is not available.' });
    });

    it('turns a rejection into a failure result', async () => {
      window.electronAPI = { copyText: vi.fn().mockRejectedValue(new Error('ipc blew up')) };
      await expect(copyText('hello')).resolves.toEqual({ success: false, error: 'ipc blew up' });
    });

    it('turns a navigator.clipboard rejection into a failure result', async () => {
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
      await expect(copyText('hello')).resolves.toEqual({ success: false, error: 'denied' });
    });
  });
});

describe('electron helpers in Chinese', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.unstubAllGlobals();
  });

  it('translates the two known main-process errors and nothing else', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(translateElectronError('File no longer exists.')).toBe('文件已不存在。');
    expect(translateElectronError('Nothing to copy.')).toBe('没有可复制的内容。');
    expect(translateElectronError('Something unexpected')).toBe('Something unexpected');
    expect(translateElectronError(undefined)).toBeUndefined();
  });

  it('translates copy failures', async () => {
    await i18n.changeLanguage('zh-CN');
    window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: false, error: 'Nothing to copy.' }) };
    await expect(copyText('')).resolves.toEqual({ success: false, error: '没有可复制的内容。' });
    window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: false }) };
    await expect(copyText('x')).resolves.toEqual({ success: false, error: '无法复制。' });
    delete window.electronAPI;
    vi.stubGlobal('navigator', {});
    await expect(copyText('x')).resolves.toEqual({ success: false, error: '剪贴板不可用。' });
  });

  it('leaves an exception text alone', async () => {
    await i18n.changeLanguage('zh-CN');
    window.electronAPI = { copyText: vi.fn().mockRejectedValue(new Error('ipc blew up')) };
    await expect(copyText('x')).resolves.toEqual({ success: false, error: 'ipc blew up' });
  });
});

describe('openInExplorer', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  it('resolves to null without the Electron bridge', async () => {
    await expect(openInExplorer('C:\\a.jpg')).resolves.toBeNull();
  });

  it('passes a success through', async () => {
    const open = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = { openInExplorer: open };
    await expect(openInExplorer('C:\\a.jpg')).resolves.toEqual({ success: true });
    expect(open).toHaveBeenCalledWith('C:\\a.jpg');
  });

  it('keeps the English error in English', async () => {
    window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false, error: 'File no longer exists.' }) };
    await expect(openInExplorer('x')).resolves.toEqual({ success: false, error: 'File no longer exists.' });
  });

  it('translates the error in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false, error: 'File no longer exists.' }) };
    await expect(openInExplorer('x')).resolves.toEqual({ success: false, error: '文件已不存在。' });
  });
});
