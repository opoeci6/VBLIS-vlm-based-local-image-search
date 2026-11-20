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

// IS_NETWORK and API_BASE are decided when the module loads, so each case loads a fresh copy of it.
describe('network mode', () => {
  let originalElectronAPI;

  const loadConfig = async (mode = 'production') => {
    vi.resetModules();
    vi.stubEnv('MODE', mode);
    return import('./config');
  };

  beforeEach(() => {
    originalElectronAPI = window.electronAPI;
    delete window.electronAPI;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (originalElectronAPI === undefined) delete window.electronAPI;
    else window.electronAPI = originalElectronAPI;
  });

  it('is on in a plain browser and points the API at the page origin', async () => {
    const { IS_NETWORK, API_BASE } = await loadConfig();
    expect(IS_NETWORK).toBe(true);
    expect(API_BASE).toBe(`${window.location.origin}/api`);
  });

  it('is off in Electron, which keeps the local backend address', async () => {
    window.electronAPI = { apiToken: 't' };
    const { IS_NETWORK, API_BASE } = await loadConfig();
    expect(IS_NETWORK).toBe(false);
    expect(API_BASE).toBe('http://127.0.0.1:8000');
  });

  it('is off under test, which keeps the local backend address', async () => {
    const { IS_NETWORK, API_BASE } = await loadConfig('test');
    expect(IS_NETWORK).toBe(false);
    expect(API_BASE).toBe('http://127.0.0.1:8000');
  });

  it('is off for the dev page that talks to a local backend with a token', async () => {
    vi.stubEnv('VITE_VBLIS_API_TOKEN', 'dev-token');
    const { IS_NETWORK, API_BASE, getApiToken } = await loadConfig('development');
    expect(IS_NETWORK).toBe(false);
    expect(API_BASE).toBe('http://127.0.0.1:8000');
    expect(getApiToken()).toBe('dev-token');
  });

  it('is on for the dev page without a token', async () => {
    const { IS_NETWORK } = await loadConfig('development');
    expect(IS_NETWORK).toBe(true);
  });

  it('sends no token: no header, and none in a media URL', async () => {
    vi.stubEnv('VITE_VBLIS_API_TOKEN', 'ignored-in-a-build');
    vi.stubEnv('DEV', false);
    const { API_BASE, getApiToken } = await loadConfig();
    const { getMediaPreviewUrl } = await import('./utils/media');
    expect(getApiToken()).toBe('');
    const url = getMediaPreviewUrl(API_BASE, { path: '/a/b.jpg', media_type: 'image' });
    expect(url).toBe(`${window.location.origin}/api/image?path=%2Fa%2Fb.jpg&size=thumbnail`);
    expect(url).not.toContain('token=');
  });

  it('can be switched by a test without reloading the module', async () => {
    const config = await loadConfig('test');
    config.setNetworkModeForTests(true);
    expect(config.IS_NETWORK).toBe(true);
    config.setNetworkModeForTests(false);
    expect(config.IS_NETWORK).toBe(false);
  });
});
