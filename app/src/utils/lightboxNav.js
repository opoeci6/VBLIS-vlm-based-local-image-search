// Moving between the pictures of a list in the lightbox: where the open picture sits, its neighbours, and
// what counts as a swipe. No wrap-around: the first picture has no previous one, the last has no next one.

// Same identity a result has in a list: its id, or path plus the frame time for a video.
export const mediaKey = (item) => (
  item.id ?? `${item.path}:${item.media_type === 'video' ? (item.timestamp_seconds ?? 0) : ''}`
);

const indexOfItem = (items, selected) => {
  if (!Array.isArray(items) || !selected) return -1;
  const byIdentity = items.indexOf(selected);
  if (byIdentity >= 0) return byIdentity;
  const key = mediaKey(selected);
  return items.findIndex(item => mediaKey(item) === key);
};

// `{ index, total }` (index 0-based) or null when the picture is not in the list.
export const lightboxPosition = (items, selected) => {
  const index = indexOfItem(items, selected);
  return index < 0 ? null : { index, total: items.length };
};

export const previousItem = (items, selected) => {
  const index = indexOfItem(items, selected);
  return index > 0 ? items[index - 1] : null;
};

export const nextItem = (items, selected) => {
  const index = indexOfItem(items, selected);
  return index >= 0 && index < items.length - 1 ? items[index + 1] : null;
};

export const SWIPE_MIN_DISTANCE_PX = 50;
export const SWIPE_MAX_DURATION_MS = 800;
export const SWIPE_MAX_SLOPE = 0.6; // |dy| may be at most this much of |dx|: a mostly horizontal move
const PINCH_ZOOM_TOLERANCE = 1.01;

// A swipe is one finger, not pinch-zoomed in (then a move pans the picture), quick, long enough and mostly
// horizontal. Swiping left shows the next picture, swiping right the previous one.
export const decideSwipe = ({ dx, dy, dt, pointerCount, viewportScale = 1 }) => {
  if (pointerCount !== 1) return null;
  if (viewportScale > PINCH_ZOOM_TOLERANCE) return null;
  if (dt >= SWIPE_MAX_DURATION_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) return null;
  if (Math.abs(dy) > SWIPE_MAX_SLOPE * Math.abs(dx)) return null;
  return dx < 0 ? 'next' : 'prev';
};
