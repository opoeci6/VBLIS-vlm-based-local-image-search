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

describe('SearchResultsGrid while browsing the library', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const browseProps = (overrides = {}) => makeProps({
    isBrowsing: true,
    browseSort: 'newest',
    browseTotal: 1234,
    onBrowseSortChange: vi.fn(),
    ...overrides,
  });

  it('shows a header with the title, the number of items in the library, and the sort toggle', () => {
    render(<SearchResultsGrid {...browseProps({ imageResults: makeImages(3), videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
    // The count is the browse total, not the number of cards.
    expect(screen.getByText('1234 items')).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Newest first' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Oldest first' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('falls back to the number of results without a total, and says "item" for one', () => {
    const { rerender } = render(<SearchResultsGrid {...browseProps({ browseTotal: null, imageResults: makeImages(3) })} />);
    expect(screen.getByText('3 items')).toBeTruthy();
    rerender(<SearchResultsGrid {...browseProps({ browseTotal: 1, imageResults: makeImages(1) })} />);
    expect(screen.getByText('1 item')).toBeTruthy();
  });

  it('says "items" in the load more footer instead of "matches"', () => {
    render(<SearchResultsGrid {...browseProps({ imageResults: makeImages(100), visibleResultsCount: 80 })} />);
    expect(screen.getByText('Loading more results (80 of 100)')).toBeTruthy();
    expect(screen.getByText('Showing 80 of 100 items')).toBeTruthy();
    expect(screen.queryByText(/matches/)).toBeNull();
  });

  it('keeps "matches" in the footer when not browsing', () => {
    render(<SearchResultsGrid {...makeProps({ imageResults: makeImages(100), visibleResultsCount: 80 })} />);
    expect(screen.getByText('Showing 80 of 100 matches')).toBeTruthy();
  });

  describe('the browse hint', () => {
    it('shows right under the Library header, with the new text, and dismisses', () => {
      const onDismissBrowseHint = vi.fn();
      render(<SearchResultsGrid {...browseProps({ showBrowseHint: true, onDismissBrowseHint })} />);
      const hint = screen.getByRole('status');
      expect(hint.textContent).toContain('Currently browsing your library. Type a search to find something specific.');
      const heading = screen.getByRole('heading', { name: 'Library' });
      expect(heading.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const firstCard = screen.getAllByAltText('Result')[0];
      expect(hint.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close hint' }));
      expect(onDismissBrowseHint).toHaveBeenCalledTimes(1);
    });

    it('is not shown when showBrowseHint is false', () => {
      render(<SearchResultsGrid {...browseProps({ showBrowseHint: false })} />);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('is not shown outside the library even when asked', () => {
      render(<SearchResultsGrid {...makeProps({ showBrowseHint: true })} />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('marks the oldest-first button when that sort is chosen', () => {
    render(<SearchResultsGrid {...browseProps({ browseSort: 'oldest' })} />);
    expect(screen.getByRole('button', { name: 'Oldest first' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Newest first' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onBrowseSortChange with the sort of the clicked button', () => {
    const props = browseProps();
    render(<SearchResultsGrid {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(props.onBrowseSortChange).toHaveBeenCalledWith('oldest');
    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(props.onBrowseSortChange).toHaveBeenCalledWith('newest');
  });

  it('names the sections Videos and Images and says how they are sorted', () => {
    const { rerender } = render(<SearchResultsGrid {...browseProps({ videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.getByRole('heading', { name: 'Videos' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Images' })).toBeTruthy();
    expect(screen.queryByText('Video Results')).toBeNull();
    expect(screen.queryByText('Image Results')).toBeNull();
    expect(screen.queryByText('Sorted by best match')).toBeNull();
    // The toggle button and the section label both say it.
    expect(screen.getAllByText('Newest first')).toHaveLength(2);

    rerender(<SearchResultsGrid {...browseProps({ videoGroups: [makeGroup('a.mp4')], browseSort: 'oldest' })} />);
    expect(screen.getAllByText('Oldest first')).toHaveLength(2);
  });

  it('shows no header and the search wording when not browsing', () => {
    render(<SearchResultsGrid {...makeProps({ videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Newest first' })).toBeNull();
    expect(screen.getByText('Video Results')).toBeTruthy();
    expect(screen.getByText('Sorted by best match')).toBeTruthy();
  });
});
