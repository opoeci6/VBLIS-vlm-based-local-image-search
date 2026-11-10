import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TerminalResultsModal } from './TerminalResultsModal';

const makeImages = (n) => Array.from({ length: n }, (_, i) => ({
  path: `/pics/img${i}.jpg`, media_type: 'image', score: 0.5, id: `img${i}`,
}));

const makeGroup = (name, frameCount = 1) => {
  const frames = Array.from({ length: frameCount }, (_, i) => (
    { path: `/videos/${name}`, media_type: 'video', score: 0.9 - i * 0.01, timestamp_seconds: 3 + i }
  ));
  return { path: `/videos/${name}`, name, frames, bestScore: 0.9, bestFrame: frames[0] };
};

const makeProps = (overrides = {}) => {
  const images = overrides.imageResults || makeImages(2);
  const visibleCount = overrides.visibleResultsCount ?? 80;
  const videoGroups = overrides.videoGroups || [];
  return {
    showSearchResults: true,
    results: [...images, ...videoGroups.flatMap(g => g.frames)],
    uiTheme: 'terminal',
    handleCloseSearchResults: vi.fn(),
    imageSearchContext: null,
    query: 'cats',
    videoGroups,
    imageResults: images,
    visibleImageResults: images.slice(0, visibleCount),
    visibleResultsCount: visibleCount,
    setVisibleResultsCount: vi.fn(),
    sentinelTerminalRef: { current: null },
    setSelectedVideoGroup: vi.fn(),
    setSelectedImage: vi.fn(),
    ...overrides,
  };
};

describe('TerminalResultsModal', () => {
  // Clicking a video card prewarms its frames with a fetch.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['search results are hidden', { showSearchResults: false }],
    ['there are no results', { results: [], imageResults: [], visibleImageResults: [] }],
    ['the theme is modern', { uiTheme: 'modern' }],
  ])('renders nothing when %s', (_label, overrides) => {
    const { container } = render(<TerminalResultsModal {...makeProps(overrides)} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the query in the header', () => {
    render(<TerminalResultsModal {...makeProps()} />);
    expect(screen.getByText('Search Results')).toBeTruthy();
    expect(screen.getByText('QUERY: cats')).toBeTruthy();
  });

  it('shows the image name for an image search', () => {
    render(<TerminalResultsModal {...makeProps({ imageSearchContext: 'cat.png' })} />);
    expect(screen.getByText('IMAGE: cat.png')).toBeTruthy();
    expect(screen.queryByText(/QUERY:/)).toBeNull();
  });

  it('pluralises the match count', () => {
    const { rerender } = render(<TerminalResultsModal {...makeProps({ imageResults: makeImages(1) })} />);
    expect(screen.getByText('1 MATCH')).toBeTruthy();
    rerender(<TerminalResultsModal {...makeProps({ imageResults: makeImages(2) })} />);
    expect(screen.getByText('2 MATCHES')).toBeTruthy();
  });

  it('counts each video once, not its frames', () => {
    render(<TerminalResultsModal {...makeProps({
      imageResults: makeImages(1),
      videoGroups: [makeGroup('a.mp4', 5), makeGroup('b.mp4', 3)],
    })} />);
    expect(screen.getByText('3 MATCHES')).toBeTruthy();
  });

  it('shows a singular match for a single video with several frames', () => {
    render(<TerminalResultsModal {...makeProps({ imageResults: [], visibleImageResults: [], videoGroups: [makeGroup('a.mp4', 4)] })} />);
    expect(screen.getByText('1 MATCH')).toBeTruthy();
  });

  it('renders video groups and image cards, with headers only when both exist', () => {
    const { rerender } = render(<TerminalResultsModal {...makeProps()} />);
    expect(screen.getAllByAltText('Result')).toHaveLength(2);
    expect(screen.queryByText('Video Results')).toBeNull();
    expect(screen.queryByText('Image Results')).toBeNull();

    rerender(<TerminalResultsModal {...makeProps({ videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.getByText('Video Results')).toBeTruthy();
    expect(screen.getByText('Image Results')).toBeTruthy();
    expect(screen.getByText('SORTED BY BEST MATCH')).toBeTruthy();
    expect(screen.getByText('a.mp4')).toBeTruthy();
  });

  it('selects a video group or an image', () => {
    const props = makeProps({ videoGroups: [makeGroup('a.mp4')] });
    render(<TerminalResultsModal {...props} />);
    fireEvent.click(screen.getByText('a.mp4'));
    expect(props.setSelectedVideoGroup).toHaveBeenCalledWith(props.videoGroups[0]);
    fireEvent.click(screen.getAllByAltText('Result')[0]);
    expect(props.setSelectedImage).toHaveBeenCalledWith(props.imageResults[0]);
  });

  it('closes with the close button and on a backdrop click, but not on a click inside', () => {
    const props = makeProps();
    const { container } = render(<TerminalResultsModal {...props} />);

    fireEvent.click(screen.getByText('Search Results'));
    expect(props.handleCloseSearchResults).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Close search results'));
    expect(props.handleCloseSearchResults).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstChild);
    expect(props.handleCloseSearchResults).toHaveBeenCalledTimes(2);
  });

  it('stays open when a drag from inside the panel ends on the backdrop', () => {
    const props = makeProps();
    const { container } = render(<TerminalResultsModal {...props} />);

    fireEvent.mouseDown(screen.getByText('Search Results'));
    fireEvent.click(container.firstChild);
    expect(props.handleCloseSearchResults).not.toHaveBeenCalled();
  });

  it('loads more results and attaches the terminal sentinel', () => {
    const props = makeProps({ imageResults: makeImages(100), visibleResultsCount: 80 });
    render(<TerminalResultsModal {...props} />);

    expect(screen.getAllByAltText('Result')).toHaveLength(80);
    expect(screen.getByText('LOAD MORE (80 OF 100)')).toBeTruthy();
    expect(props.sentinelTerminalRef.current).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /LOAD MORE/ }));
    const updater = props.setVisibleResultsCount.mock.calls[0][0];
    expect(updater(80)).toBe(100);
  });

  it('hides load more when everything is visible', () => {
    render(<TerminalResultsModal {...makeProps()} />);
    expect(screen.queryByText(/LOAD MORE/)).toBeNull();
  });
  describe('filter chips', () => {
    const makeChips = (labels) => labels.map(label => ({ key: label, label, onRemove: vi.fn() }));

    it('shows no chips by default', () => {
      render(<TerminalResultsModal {...makeProps()} />);
      expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
    });

    it('lists the active filters under the header and removes one', () => {
      const filterChips = makeChips(['Images only', '2024']);
      render(<TerminalResultsModal {...makeProps({ filterChips, onClearFilters: vi.fn() })} />);
      expect(screen.getByRole('group', { name: 'Active filters' })).toBeTruthy();
      expect(screen.getByText('Images only')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Remove filter: 2024' }));
      expect(filterChips[1].onRemove).toHaveBeenCalledTimes(1);
    });

    it('clears all filters, and does not close the results while doing so', () => {
      const props = makeProps({ filterChips: makeChips(['Images only', '2024']), onClearFilters: vi.fn() });
      render(<TerminalResultsModal {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
      expect(props.onClearFilters).toHaveBeenCalledTimes(1);
      expect(props.handleCloseSearchResults).not.toHaveBeenCalled();
    });
  });
  describe('Filters button', () => {
    it('sits in the header row before the close button, with no badge by default', () => {
      render(<TerminalResultsModal {...makeProps()} />);
      const filters = screen.getByRole('button', { name: 'Search filters' });
      const close = screen.getByLabelText('Close search results');
      expect(filters.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(filters.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('filters-count')).toBeNull();
    });

    it('shows the active count and the open state', () => {
      render(<TerminalResultsModal {...makeProps({ activeFilterCount: 2, filtersOpen: true })} />);
      const filters = screen.getByRole('button', { name: 'Search filters (2 active)' });
      expect(filters.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId('filters-count').textContent).toBe('2');
    });

    it('calls the toggle without closing the results', () => {
      const props = makeProps({ onToggleFilters: vi.fn() });
      render(<TerminalResultsModal {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      expect(props.onToggleFilters).toHaveBeenCalledTimes(1);
      expect(props.handleCloseSearchResults).not.toHaveBeenCalled();
    });
  });
});

describe('TerminalResultsModal while browsing the library', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const browseProps = (overrides = {}) => makeProps({
    query: '',
    isBrowsing: true,
    browseSort: 'newest',
    browseTotal: 1234,
    onBrowseSortChange: vi.fn(),
    ...overrides,
  });

  it('titles the console Library with the sort in the line under it', () => {
    const { rerender } = render(<TerminalResultsModal {...browseProps()} />);
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
    expect(screen.getByText('BROWSING · NEWEST FIRST')).toBeTruthy();
    expect(screen.queryByText(/QUERY:/)).toBeNull();
    expect(screen.queryByText('Search Results')).toBeNull();

    rerender(<TerminalResultsModal {...browseProps({ browseSort: 'oldest' })} />);
    expect(screen.getByText('BROWSING · OLDEST FIRST')).toBeTruthy();
  });

  it('shows "N ITEMS" with the browse total', () => {
    render(<TerminalResultsModal {...browseProps({ imageResults: makeImages(3), videoGroups: [makeGroup('a.mp4', 3)] })} />);
    expect(screen.getByText('1234 ITEMS')).toBeTruthy();
    expect(screen.queryByText(/MATCH/)).toBeNull();
    expect(screen.queryByText(/ OF /)).toBeNull();
  });

  it('falls back to the number of items without a total, and says ITEM for one', () => {
    const { rerender } = render(<TerminalResultsModal {...browseProps({ browseTotal: null, imageResults: makeImages(3), videoGroups: [makeGroup('a.mp4', 3)] })} />);
    expect(screen.getByText('4 ITEMS')).toBeTruthy();
    rerender(<TerminalResultsModal {...browseProps({ browseTotal: 1, imageResults: makeImages(1) })} />);
    expect(screen.getByText('1 ITEM')).toBeTruthy();
  });

  describe('the browse hint', () => {
    it('shows under the console header and above the results, with the new text, and dismisses', () => {
      const onDismissBrowseHint = vi.fn();
      render(<TerminalResultsModal {...browseProps({ showBrowseHint: true, onDismissBrowseHint })} />);
      const hint = screen.getByRole('status');
      expect(hint.textContent).toContain('Currently browsing your library. Type a search to find something specific.');
      const heading = screen.getByRole('heading', { name: 'Library' });
      expect(heading.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const firstCard = screen.getAllByAltText('Result')[0];
      expect(hint.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close hint' }));
      expect(onDismissBrowseHint).toHaveBeenCalledTimes(1);
    });

    it('is above the filter chips', () => {
      const filterChips = [{ key: 'media', label: 'Images only', onRemove: vi.fn() }];
      render(<TerminalResultsModal {...browseProps({ showBrowseHint: true, filterChips, onClearFilters: vi.fn() })} />);
      const hint = screen.getByRole('status');
      const chip = screen.getByText('Images only');
      expect(hint.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is not shown when showBrowseHint is false or outside the library', () => {
      const { rerender } = render(<TerminalResultsModal {...browseProps({ showBrowseHint: false })} />);
      expect(screen.queryByRole('status')).toBeNull();
      rerender(<TerminalResultsModal {...makeProps({ showBrowseHint: true })} />);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('has the two-button sort toggle in the header', () => {
    const props = browseProps({ browseSort: 'oldest' });
    render(<TerminalResultsModal {...props} />);
    expect(screen.getByRole('button', { name: 'Oldest first' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Newest first' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(props.onBrowseSortChange).toHaveBeenCalledWith('newest');
  });

  it('says how the sections are sorted and names them Videos and Images', () => {
    const { rerender } = render(<TerminalResultsModal {...browseProps({ videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.getByText('NEWEST FIRST')).toBeTruthy();
    expect(screen.queryByText('SORTED BY BEST MATCH')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Videos' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Images' })).toBeTruthy();

    rerender(<TerminalResultsModal {...browseProps({ videoGroups: [makeGroup('a.mp4')], browseSort: 'oldest' })} />);
    expect(screen.getByText('OLDEST FIRST')).toBeTruthy();
  });

  it('has no toggle and keeps the search wording when not browsing', () => {
    render(<TerminalResultsModal {...makeProps({ videoGroups: [makeGroup('a.mp4')] })} />);
    expect(screen.queryByRole('button', { name: 'Newest first' })).toBeNull();
    expect(screen.getByText('SORTED BY BEST MATCH')).toBeTruthy();
  });
});
