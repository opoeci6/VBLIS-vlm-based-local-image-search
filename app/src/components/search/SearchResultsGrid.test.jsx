import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchResultsGrid } from './SearchResultsGrid';

const makeImages = (n) => Array.from({ length: n }, (_, i) => ({
  path: `/pics/img${i}.jpg`, media_type: 'image', score: 0.5, id: `img${i}`,
}));

const makeGroup = (name) => {
  const frame = { path: `/videos/${name}`, media_type: 'video', score: 0.9, timestamp_seconds: 3 };
  return { path: `/videos/${name}`, name, frames: [frame], bestScore: 0.9, bestFrame: frame };
};

const makeProps = (overrides = {}) => {
  const images = overrides.imageResults || makeImages(3);
  const visibleCount = overrides.visibleResultsCount ?? 80;
  const videoGroups = overrides.videoGroups || [];
  return {
    results: [...images, ...videoGroups.flatMap(g => g.frames)],
    uiTheme: 'modern',
    videoGroups,
    imageResults: images,
    visibleImageResults: images.slice(0, visibleCount),
    visibleResultsCount: visibleCount,
    setVisibleResultsCount: vi.fn(),
    sentinelRef: { current: null },
    setSelectedVideoGroup: vi.fn(),
    setSelectedImage: vi.fn(),
    ...overrides,
  };
};

describe('SearchResultsGrid', () => {
  // Clicking a video card prewarms its frames with a fetch.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing without results', () => {
    const { container } = render(<SearchResultsGrid {...makeProps({ results: [], imageResults: [], visibleImageResults: [] })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing in the terminal theme', () => {
    const { container } = render(<SearchResultsGrid {...makeProps({ uiTheme: 'terminal' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders image cards without section headers when there are only images', () => {
    render(<SearchResultsGrid {...makeProps()} />);
    expect(screen.getAllByAltText('Result')).toHaveLength(3);
    expect(screen.queryByText('Video Results')).toBeNull();
    expect(screen.queryByText('Image Results')).toBeNull();
  });

  it('renders only the video header when there are only videos', () => {
    render(<SearchResultsGrid {...makeProps({
      imageResults: [], visibleImageResults: [], videoGroups: [makeGroup('a.mp4')],
    })} />);
    expect(screen.getByText('Video Results')).toBeTruthy();
    expect(screen.getByText('a.mp4')).toBeTruthy();
    expect(screen.queryByText('Image Results')).toBeNull();
  });

  it('shows both headers when both kinds exist', () => {
    render(<SearchResultsGrid {...makeProps({ videoGroups: [makeGroup('a.mp4'), makeGroup('b.mp4')] })} />);
    expect(screen.getByText('Video Results')).toBeTruthy();
    expect(screen.getByText('Image Results')).toBeTruthy();
    expect(screen.getByText('Sorted by best match')).toBeTruthy();
  });

  it('selects a video group or an image from the cards', () => {
    const props = makeProps({ videoGroups: [makeGroup('a.mp4')] });
    render(<SearchResultsGrid {...props} />);
    fireEvent.click(screen.getByText('a.mp4'));
    expect(props.setSelectedVideoGroup).toHaveBeenCalledWith(props.videoGroups[0]);

    fireEvent.click(screen.getAllByAltText('Result')[1]);
    expect(props.setSelectedImage).toHaveBeenCalledWith(props.imageResults[1]);
  });

  describe('load more', () => {
    it('is hidden when everything is visible', () => {
      render(<SearchResultsGrid {...makeProps()} />);
      expect(screen.queryByText(/Loading more results/)).toBeNull();
    });

    it('grows the visible count by 80, capped at the total, and attaches the sentinel ref', () => {
      const props = makeProps({ imageResults: makeImages(100), visibleResultsCount: 80 });
      render(<SearchResultsGrid {...props} />);

      expect(screen.getAllByAltText('Result')).toHaveLength(80);
      expect(screen.getByText('Loading more results (80 of 100)')).toBeTruthy();
      expect(screen.getByText('Showing 80 of 100 matches')).toBeTruthy();
      expect(props.sentinelRef.current).toBeTruthy();
      expect(props.sentinelRef.current.contains(screen.getByRole('button'))).toBe(true);

      fireEvent.click(screen.getByRole('button'));
      expect(props.setVisibleResultsCount).toHaveBeenCalledTimes(1);
      const updater = props.setVisibleResultsCount.mock.calls[0][0];
      expect(updater(80)).toBe(100);
      expect(updater(10)).toBe(90);
    });
  });
});
