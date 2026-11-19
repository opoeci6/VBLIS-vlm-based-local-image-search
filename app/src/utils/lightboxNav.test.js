import { describe, expect, it } from 'vitest';
import { decideSwipe, lightboxPosition, mediaKey, nextItem, previousItem } from './lightboxNav';

describe('mediaKey', () => {
  it('uses the id when there is one', () => {
    expect(mediaKey({ id: 'abc', path: '/a.jpg' })).toBe('abc');
  });

  it('uses the path for an image', () => {
    expect(mediaKey({ path: '/a.jpg', media_type: 'image' })).toBe('/a.jpg:');
  });

  it('adds the frame time for a video, 0 when it is missing', () => {
    expect(mediaKey({ path: '/v.mp4', media_type: 'video', timestamp_seconds: 65 })).toBe('/v.mp4:65');
    expect(mediaKey({ path: '/v.mp4', media_type: 'video' })).toBe('/v.mp4:0');
  });
});

describe('lightbox position and neighbours', () => {
  const items = [
    { path: '/a.jpg', media_type: 'image' },
    { path: '/b.jpg', media_type: 'image' },
    { path: '/c.jpg', media_type: 'image' },
  ];

  it('finds an item by identity', () => {
    expect(lightboxPosition(items, items[1])).toEqual({ index: 1, total: 3 });
  });

  it('finds an item by key when it is a copy', () => {
    expect(lightboxPosition(items, { ...items[2] })).toEqual({ index: 2, total: 3 });
  });

  it('tells apart two frames of one video', () => {
    const frames = [
      { path: '/v.mp4', media_type: 'video', timestamp_seconds: 1 },
      { path: '/v.mp4', media_type: 'video', timestamp_seconds: 9 },
    ];
    expect(lightboxPosition(frames, { ...frames[1] })).toEqual({ index: 1, total: 2 });
  });

  it('is null when the item is not in the list, or there is no list or item', () => {
    expect(lightboxPosition(items, { path: '/other.jpg', media_type: 'image' })).toBeNull();
    expect(lightboxPosition([], items[0])).toBeNull();
    expect(lightboxPosition(undefined, items[0])).toBeNull();
    expect(lightboxPosition(items, null)).toBeNull();
  });

  it('gives the neighbours and stops at the ends', () => {
    expect(previousItem(items, items[1])).toBe(items[0]);
    expect(nextItem(items, items[1])).toBe(items[2]);
    expect(previousItem(items, items[0])).toBeNull();
    expect(nextItem(items, items[2])).toBeNull();
  });

  it('has no neighbours for an item outside the list', () => {
    const outside = { path: '/other.jpg', media_type: 'image' };
    expect(previousItem(items, outside)).toBeNull();
    expect(nextItem(items, outside)).toBeNull();
  });
});

describe('decideSwipe', () => {
  const swipe = (overrides = {}) => decideSwipe({ dx: -120, dy: 10, dt: 200, pointerCount: 1, viewportScale: 1, ...overrides });

  it('swipes left to the next picture and right to the previous one', () => {
    expect(swipe({ dx: -120 })).toBe('next');
    expect(swipe({ dx: 120 })).toBe('prev');
  });

  it('needs 50 px', () => {
    expect(swipe({ dx: -49, dy: 0 })).toBeNull();
    expect(swipe({ dx: -50, dy: 0 })).toBe('next');
    expect(swipe({ dx: 49, dy: 0 })).toBeNull();
    expect(swipe({ dx: 50, dy: 0 })).toBe('prev');
  });

  it('needs to be quicker than 800 ms', () => {
    expect(swipe({ dt: 799 })).toBe('next');
    expect(swipe({ dt: 800 })).toBeNull();
  });

  it('needs to be mostly horizontal: |dy| at most 0.6 of |dx|', () => {
    expect(swipe({ dx: -100, dy: 60 })).toBe('next');
    expect(swipe({ dx: -100, dy: -60 })).toBe('next');
    expect(swipe({ dx: -100, dy: 61 })).toBeNull();
    expect(swipe({ dx: 100, dy: -61 })).toBeNull();
  });

  it('ignores a gesture with two pointers or none', () => {
    expect(swipe({ pointerCount: 2 })).toBeNull();
    expect(swipe({ pointerCount: 0 })).toBeNull();
  });

  it('ignores a swipe on a picture that is pinch-zoomed', () => {
    expect(swipe({ viewportScale: 1.01 })).toBe('next');
    expect(swipe({ viewportScale: 1.02 })).toBeNull();
    expect(swipe({ viewportScale: 2 })).toBeNull();
  });

  it('treats a missing scale as not zoomed', () => {
    expect(decideSwipe({ dx: -120, dy: 0, dt: 100, pointerCount: 1 })).toBe('next');
  });
});
