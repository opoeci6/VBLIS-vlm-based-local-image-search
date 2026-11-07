import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThumbnailCacheSection } from './ThumbnailCacheSection';

const makeProps = (overrides = {}) => ({
  cacheStats: {
    images: { count: 3, bytes: 3000, formatted: '2.9 KB' },
    videos: { count: 5, bytes: 9000, formatted: '8.8 KB' },
    total: { count: 8, bytes: 12000, formatted: '11.7 KB' },
  },
  showConfirmClearThumbnails: null,
  setShowConfirmClearThumbnails: vi.fn(),
  handleClearThumbnailCache: vi.fn(),
  isClearingThumbnails: false,
  status: { is_indexing: false, is_rebuilding_video_thumbnails: false },
  handleRebuildVideoThumbnails: vi.fn(),
  isTriggeringRebuildThumbnails: false,
  ...overrides,
});

const renderSection = (overrides) => {
  const props = makeProps(overrides);
  return { props, ...render(<ThumbnailCacheSection {...props} />) };
};

describe('ThumbnailCacheSection', () => {
  afterEach(cleanup);

  it('shows the totals, sizes and counts', () => {
    renderSection();
    expect(screen.getByText('Thumbnail Cache Management')).toBeTruthy();
    expect(screen.getByText('Total: 11.7 KB')).toBeTruthy();
    expect(screen.getByText('2.9 KB · 3 items')).toBeTruthy();
    expect(screen.getByText('8.8 KB · 5 frames')).toBeTruthy();
  });

  describe('images', () => {
    it('asks for confirmation, then clears images', () => {
      const { props, rerender } = renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Clear Image Cache/ }));
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith('images');

      rerender(<ThumbnailCacheSection {...props} showConfirmClearThumbnails="images" />);
      expect(screen.getByText(/Clear all image thumbnails\?/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Yes, Clear Images/ }));
      expect(props.handleClearThumbnailCache).toHaveBeenCalledWith('images');
    });

    it('cancels the confirmation', () => {
      const { props } = renderSection({ showConfirmClearThumbnails: 'images' });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith(null);
    });

    it('disables the clear button when the cache is empty', () => {
      renderSection({
        cacheStats: {
          images: { count: 0, bytes: 0, formatted: '0 B' },
          videos: { count: 0, bytes: 0, formatted: '0 B' },
          total: { count: 0, bytes: 0, formatted: '0 B' },
        },
      });
      expect(screen.getByRole('button', { name: /Clear Image Cache/ }).disabled).toBe(true);
      expect(screen.getByTitle('Clear only video thumbnails').disabled).toBe(true);
    });
  });

  describe('videos', () => {
    it('asks for confirmation, then clears videos', () => {
      const { props, rerender } = renderSection();
      fireEvent.click(screen.getByTitle('Clear only video thumbnails'));
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith('videos');

      rerender(<ThumbnailCacheSection {...props} showConfirmClearThumbnails="videos" />);
      expect(screen.getByText(/Clear video thumbnails\?/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Yes, Clear Videos/ }));
      expect(props.handleClearThumbnailCache).toHaveBeenCalledWith('videos');
    });

    it('rebuilds video thumbnails', () => {
      const { props } = renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Rebuild Videos/ }));
      expect(props.handleRebuildVideoThumbnails).toHaveBeenCalledTimes(1);
    });

    it('disables rebuilding while indexing or triggering', () => {
      const { unmount } = renderSection({ status: { is_indexing: true, is_rebuilding_video_thumbnails: false } });
      expect(screen.getByRole('button', { name: /Rebuild Videos/ }).disabled).toBe(true);
      unmount();
      renderSection({ isTriggeringRebuildThumbnails: true });
      expect(screen.getByRole('button', { name: /Rebuild Videos/ }).disabled).toBe(true);
    });

    it('shows rebuild progress instead of the buttons', () => {
      renderSection({
        status: {
          is_indexing: false, is_rebuilding_video_thumbnails: true,
          rebuilt_video_frames: 25, total_video_frames_to_rebuild: 100,
        },
      });
      expect(screen.getByText('Rebuilding Video Thumbnails...')).toBeTruthy();
      expect(screen.getByText('25%')).toBeTruthy();
      expect(screen.getByText('25 of 100 frames cached')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Rebuild Videos/ })).toBeNull();
    });

    it('shows "Starting..." before the total is known', () => {
      renderSection({
        status: { is_indexing: false, is_rebuilding_video_thumbnails: true, rebuilt_video_frames: 0, total_video_frames_to_rebuild: 0 },
      });
      expect(screen.getByText('Starting...')).toBeTruthy();
      expect(screen.getByText('0 of ? frames cached')).toBeTruthy();
    });
  });
});
