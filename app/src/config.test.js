import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiToken } from './config';

describe('getApiToken', () => {
  let originalElectronAPI;

  beforeEach(() => {
    originalElectronAPI = window.electronAPI;
    delete window.electronAPI;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalElectronAPI === undefined) delete window.electronAPI;
    else window.electronAPI = originalElectronAPI;
  });

  it('is empty without electronAPI or env token', () => {
    expect(getApiToken()).toBe('');
  });

  it('reads the token from electronAPI', () => {
    window.electronAPI = { apiToken: 'from-electron' };
    expect(getApiToken()).toBe('from-electron');
  });

  it('falls back to the dev env token', () => {
    vi.stubEnv('VITE_VBLIS_API_TOKEN', 'from-env');
    expect(getApiToken()).toBe('from-env');
  });

  it('prefers electronAPI over the env token', () => {
    vi.stubEnv('VITE_VBLIS_API_TOKEN', 'from-env');
    window.electronAPI = { apiToken: 'from-electron' };
    expect(getApiToken()).toBe('from-electron');
  });

  it('ignores the env token outside dev', () => {
    vi.stubEnv('VITE_VBLIS_API_TOKEN', 'from-env');
    vi.stubEnv('DEV', false);
    expect(getApiToken()).toBe('');
  });
});
