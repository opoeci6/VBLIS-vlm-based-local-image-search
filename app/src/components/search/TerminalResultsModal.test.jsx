import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TerminalResultsModal } from './TerminalResultsModal';

const makeImages = (n) => Array.from({ length: n }, (_, i) => ({
  path: `/pics/img${i}.jpg`, media_type: 'image', score: 0.5, id: `img${i}`,
}));

const makeGroup = (name) => {
  const frame = { path: `/videos/${name}`, media_type: 'video', score: 0.9, timestamp_seconds: 3 };
  return { path: `/videos/${name}`, name, frames: [frame], bestScore: 0.9, bestFrame: frame };
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
});
