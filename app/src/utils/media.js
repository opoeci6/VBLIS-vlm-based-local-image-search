import { getApiToken, IS_NETWORK } from '../config';
import { apiFetch } from './api';

// Matches PREVIEW_MAX_SIDE on the server. A browser whose screen can't show more than this many device
// pixels gets the screen-sized picture instead of a 48 MP original; Open original and Download still
// give the file itself.
const PREVIEW_MAX_SIDE = 2560;

// The longest side of the screen in device pixels, or 0 when the browser doesn't say.
const screenLongSidePx = () => {
  const screen = typeof window !== 'undefined' ? window.screen : null;
  const ratio = Number(typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const side = Math.max(Number(screen?.width) || 0, Number(screen?.height) || 0) * ratio;
  return Number.isFinite(side) ? side : 0;
};

const screenFitsPreview = () => {
  const side = screenLongSidePx();
  return side > 0 && side <= PREVIEW_MAX_SIDE;
};

// <img src> can't send headers, so the token goes in the query (backend accepts it only on GET /image)
export const getMediaPreviewUrl = (API_BASE, item, size = 'thumbnail') => {
  if (size === 'full' && IS_NETWORK && screenFitsPreview()) size = 'preview';
  const params = new URLSearchParams({ path: item.path, size });
  if (item.media_type === 'video') {
    params.set('timestamp', String(item.timestamp_seconds ?? 1.0));
  }
  const token = getApiToken();
  if (token) params.set('token', token);
  return `${API_BASE}/image?${params.toString()}`;
};

const prewarmedVideoPaths = new Set();
export const prewarmVideoGroup = async (API_BASE, group) => {
  if (!group || !group.path || !group.frames || group.frames.length === 0) return;
  if (prewarmedVideoPaths.has(group.path)) return;
  prewarmedVideoPaths.add(group.path);
  try {
    const timestamps = group.frames.map(f => f.timestamp_seconds ?? 0);
    await apiFetch(`${API_BASE}/video/frames/batch-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: group.path, timestamps })
    });
  } catch (err) {
    console.debug('Batch prewarm skipped or failed:', err);
  }
};

export const getFileName = (path) => path.split('\\').pop().split('/').pop();
