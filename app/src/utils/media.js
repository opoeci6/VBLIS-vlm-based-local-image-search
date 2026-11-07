import { getApiToken } from '../config';
import { apiFetch } from './api';

// <img src> can't send headers, so the token goes in the query (backend accepts it only on GET /image)
export const getMediaPreviewUrl = (API_BASE, item, size = 'thumbnail') => {
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
