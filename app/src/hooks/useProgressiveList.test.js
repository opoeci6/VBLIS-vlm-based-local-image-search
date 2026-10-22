import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProgressiveList } from './useProgressiveList';

const API = 'http://127.0.0.1:8000';

const makeItems = (n) => Array.from({ length: n }, (_, i) => ({ path: `/img/${i}.jpg`, media_type: 'image' }));

describe('useProgressiveList', () => {
  let observers;
  let images;
  let originalImage;

  beforeEach(() => {
    observers = [];
    images = [];
    class FakeIntersectionObserver {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observed = [];
        this.disconnect = vi.fn();
        observers.push(this);
      }
      observe(el) {
        this.observed.push(el);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    originalImage = window.Image;
    window.Image = class FakeImage {
      set src(value) {
        images.push(value);
      }
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.Image = originalImage;
    vi.unstubAllGlobals();
  });

  const setup = (props) => renderHook((p) => useProgressiveList(p), { initialProps: props });

  describe('infinite scroll observer', () => {
    it('does not create an observer when everything is already visible', () => {
      setup({ items: makeItems(50), visibleCount: 80, setVisibleCount: vi.fn() });
      expect(observers).toHaveLength(0);

      setup({ items: makeItems(80), visibleCount: 80, setVisibleCount: vi.fn() });
      expect(observers).toHaveLength(0);
    });

    it('creates an observer with a 500px margin when more items remain', () => {
      setup({ items: makeItems(200), visibleCount: 80, setVisibleCount: vi.fn() });
      expect(observers).toHaveLength(1);
      expect(observers[0].options).toEqual({ root: null, rootMargin: '500px', threshold: 0.01 });
    });

    it('observes whichever sentinel refs are attached when the effect re-runs', () => {
      const setVisibleCount = vi.fn();
      const props = { items: makeItems(300), visibleCount: 80, setVisibleCount };
      const { result, rerender } = setup(props);
      expect(observers[0].observed).toEqual([]);

      const grid = document.createElement('div');
      const terminal = document.createElement('div');
      result.current.sentinelRef.current = grid;
      result.current.sentinelTerminalRef.current = terminal;
      rerender({ ...props, visibleCount: 160 });

      const latest = observers[observers.length - 1];
      expect(latest.observed).toEqual([grid, terminal]);

      result.current.sentinelTerminalRef.current = null;
      rerender({ ...props, visibleCount: 240 });
      expect(observers[observers.length - 1].observed).toEqual([grid]);
    });

    it('grows the visible count by 80 (capped at items.length) when a sentinel intersects', () => {
      const setVisibleCount = vi.fn();
      setup({ items: makeItems(200), visibleCount: 80, setVisibleCount });

      act(() => observers[0].callback([{ isIntersecting: true }]));
      expect(setVisibleCount).toHaveBeenCalledTimes(1);
      const updater = setVisibleCount.mock.calls[0][0];
      expect(updater(80)).toBe(160);
      expect(updater(150)).toBe(200);
    });

    it('ignores entries that are not intersecting', () => {
      const setVisibleCount = vi.fn();
      setup({ items: makeItems(200), visibleCount: 80, setVisibleCount });
      act(() => observers[0].callback([{ isIntersecting: false }]));
      expect(setVisibleCount).not.toHaveBeenCalled();
    });

    it('disconnects on unmount and when the effect re-runs', () => {
      const props = { items: makeItems(300), visibleCount: 80, setVisibleCount: vi.fn() };
      const { rerender, unmount } = setup(props);
      rerender({ ...props, visibleCount: 160 });
      expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
      unmount();
      expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('thumbnail prefetch', () => {
    it('prefetches the next 80 thumbnails after 150 ms', () => {
      const items = makeItems(300);
      setup({ items, visibleCount: 80, setVisibleCount: vi.fn() });

      vi.advanceTimersByTime(149);
      expect(images).toHaveLength(0);
      vi.advanceTimersByTime(1);

      expect(images).toHaveLength(80);
      expect(images[0]).toBe(`${API}/image?path=%2Fimg%2F80.jpg&size=thumbnail`);
      expect(images[79]).toBe(`${API}/image?path=%2Fimg%2F159.jpg&size=thumbnail`);
    });

    it('prefetches only what is left when fewer than 80 remain', () => {
      setup({ items: makeItems(100), visibleCount: 80, setVisibleCount: vi.fn() });
      vi.advanceTimersByTime(150);
      expect(images).toHaveLength(20);
    });

    it('does nothing when everything is visible', () => {
      setup({ items: makeItems(40), visibleCount: 80, setVisibleCount: vi.fn() });
      vi.advanceTimersByTime(1000);
      expect(images).toHaveLength(0);
    });

    it('cancels a pending prefetch on unmount', () => {
      const { unmount } = setup({ items: makeItems(300), visibleCount: 80, setVisibleCount: vi.fn() });
      unmount();
      vi.advanceTimersByTime(1000);
      expect(images).toHaveLength(0);
    });
  });
});
