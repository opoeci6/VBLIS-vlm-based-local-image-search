import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getFileName, getMediaPreviewUrl, prewarmVideoGroup } from './media';

const API = 'http://127.0.0.1:8000';

describe('getMediaPreviewUrl', () => {
  it('builds the thumbnail URL for an image by default', () => {
    const url = getMediaPreviewUrl(API, { path: 'C:\\pics\\a.jpg', media_type: 'image' });
    expect(url).toBe(`${API}/image?path=C%3A%5Cpics%5Ca.jpg&size=thumbnail`);
  });

  it('supports the full size', () => {
    const url = getMediaPreviewUrl(API, { path: '/x/a.jpg' }, 'full');
    expect(url).toBe(`${API}/image?path=%2Fx%2Fa.jpg&size=full`);
  });

  it('adds the timestamp for a video frame', () => {
    const url = getMediaPreviewUrl(API, { path: '/v/a.mp4', media_type: 'video', timestamp_seconds: 12.5 });
    expect(url).toBe(`${API}/image?path=%2Fv%2Fa.mp4&size=thumbnail&timestamp=12.5`);
  });

  it('falls back to timestamp=1 for a video without one', () => {
    const url = getMediaPreviewUrl(API, { path: '/v/a.mp4', media_type: 'video' });
    expect(url).toBe(`${API}/image?path=%2Fv%2Fa.mp4&size=thumbnail&timestamp=1`);
  });

  it('keeps timestamp 0 for a video frame at the start', () => {
    const url = getMediaPreviewUrl(API, { path: '/v/a.mp4', media_type: 'video', timestamp_seconds: 0 }, 'full');
    expect(url).toBe(`${API}/image?path=%2Fv%2Fa.mp4&size=full&timestamp=0`);
  });

  describe('with an API token', () => {
    beforeEach(() => {
      window.electronAPI = { apiToken: 'tok/1' };
    });

    afterEach(() => {
      delete window.electronAPI;
    });

    it('appends the token as the last query parameter for an image', () => {
      const url = getMediaPreviewUrl(API, { path: '/x/a.jpg', media_type: 'image' }, 'full');
      expect(url).toBe(`${API}/image?path=%2Fx%2Fa.jpg&size=full&token=tok%2F1`);
    });

    it('appends the token after the timestamp for a video frame', () => {
      const url = getMediaPreviewUrl(API, { path: '/v/a.mp4', media_type: 'video', timestamp_seconds: 12.5 });
      expect(url).toBe(`${API}/image?path=%2Fv%2Fa.mp4&size=thumbnail&timestamp=12.5&token=tok%2F1`);
    });
  });
});

describe('prewarmVideoGroup', () => {
  let fetchMock;
  let counter = 0;
  const uniquePath = () => `/videos/prewarm-${++counter}.mp4`;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the path and timestamps once per path', async () => {
    const path = uniquePath();
    const group = {
      path,
      frames: [{ timestamp_seconds: 3.5 }, { timestamp_seconds: undefined }, { timestamp_seconds: 0 }],
    };
    await prewarmVideoGroup(API, group);
    await prewarmVideoGroup(API, group);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/video/frames/batch-extract`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ path, timestamps: [3.5, 0, 0] });
  });

  it('does nothing for missing or empty frames or missing group', async () => {
    await prewarmVideoGroup(API, null);
    await prewarmVideoGroup(API, undefined);
    await prewarmVideoGroup(API, { path: uniquePath() });
    await prewarmVideoGroup(API, { path: uniquePath(), frames: [] });
    await prewarmVideoGroup(API, { frames: [{}] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected fetch and does not retry that path', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('network down'));
    const group = { path: uniquePath(), frames: [{ timestamp_seconds: 1 }] };

    await expect(prewarmVideoGroup(API, group)).resolves.toBeUndefined();
    await prewarmVideoGroup(API, group);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getFileName', () => {
  it('handles Windows paths', () => {
    expect(getFileName('C:\\Users\\me\\clip.mp4')).toBe('clip.mp4');
  });

  it('handles posix paths', () => {
    expect(getFileName('/home/me/clip.mp4')).toBe('clip.mp4');
  });

  it('handles mixed separators', () => {
    expect(getFileName('C:\\Users/me\\sub/clip.mp4')).toBe('clip.mp4');
    expect(getFileName('/home/me\\clip.mp4')).toBe('clip.mp4');
  });

  it('returns the input when there is no separator and empty for a trailing one', () => {
    expect(getFileName('clip.mp4')).toBe('clip.mp4');
    expect(getFileName('/home/me/')).toBe('');
  });
});
