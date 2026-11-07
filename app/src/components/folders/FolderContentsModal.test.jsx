import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderContentsModal } from './FolderContentsModal';

const makeItems = (n) => Array.from({ length: n }, (_, i) => ({
  path: `/photos/item${i}.jpg`,
  name: `item${i}.jpg`,
  relative_path: `sub/item${i}.jpg`,
  media_type: 'image',
  size: 1000,
  is_indexed: true,
  exists_on_disk: true,
}));

const makeContents = (overrides = {}) => ({
  items: makeItems(5),
  image_count: 5,
  video_count: 0,
  indexed_count: 4,
  unindexed_count: 0,
  missing_on_disk_count: 0,
  total_count: 5,
  truncated: false,
  limit: 5000,
  ...overrides,
});

const makeProps = (overrides = {}) => ({
  showFolderContents: true,
  browsingFolder: { path: '/photos', name: 'photos' },
  folderContents: makeContents(),
  isFetchingFolderContents: false,
  isCleaningGhostRecords: false,
  setIsCleaningGhostRecords: vi.fn(),
  folderVisibleLimit: 60,
  setFolderVisibleLimit: vi.fn(),
  handleCloseFolderContents: vi.fn(),
  handleReindexFolder: vi.fn().mockResolvedValue(undefined),
  setSelectedImage: vi.fn(),
  setToast: vi.fn(),
  uiTheme: 'modern',
  ...overrides,
});

const renderModal = (overrides) => {
  const props = makeProps(overrides);
  return { props, ...render(<FolderContentsModal {...props} />) };
};

describe('FolderContentsModal', () => {
  afterEach(cleanup);

  it.each([
    ['closed', { showFolderContents: false }],
    ['there is no folder', { browsingFolder: null }],
  ])('renders nothing when %s', (_label, overrides) => {
    const { container } = renderModal(overrides);
    expect(container.firstChild).toBeNull();
  });

  it('shows the folder path and the count badges', () => {
    renderModal({ folderContents: makeContents({ video_count: 2, unindexed_count: 1 }) });
    expect(screen.getByText('Folder Contents')).toBeTruthy();
    expect(screen.getByText('/photos')).toBeTruthy();
    expect(screen.getByText('5 images')).toBeTruthy();
    expect(screen.getByText('2 videos')).toBeTruthy();
    expect(screen.getByText('4 indexed')).toBeTruthy();
    expect(screen.getByText('1 unindexed')).toBeTruthy();
    expect(screen.getByText('5 total files')).toBeTruthy();
    expect(screen.queryByText(/missing from disk/)).toBeNull();
  });

  it('closes on a backdrop click and the close button, but not on a click inside', () => {
    const { props, container } = renderModal();
    fireEvent.click(screen.getByText('Folder Contents'));
    expect(props.handleCloseFolderContents).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild);
    expect(props.handleCloseFolderContents).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(props.handleCloseFolderContents).toHaveBeenCalledTimes(2);
  });

  describe('ghost records', () => {
    const withMissing = () => ({ folderContents: makeContents({ missing_on_disk_count: 2 }) });

    it('shows the missing count and the clean button', () => {
      renderModal(withMissing());
      expect(screen.getByText('2 missing from disk')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Clean Ghost Records/ })).toBeTruthy();
    });

    it('re-syncs the folder between setIsCleaningGhostRecords(true) and (false)', async () => {
      const calls = [];
      const setIsCleaningGhostRecords = vi.fn((v) => calls.push(`clean:${v}`));
      const handleReindexFolder = vi.fn(async (path) => { calls.push(`reindex:${path}`); });
      renderModal({ ...withMissing(), setIsCleaningGhostRecords, handleReindexFolder });

      fireEvent.click(screen.getByRole('button', { name: /Clean Ghost Records/ }));
      await waitFor(() => expect(calls).toEqual(['clean:true', 'reindex:/photos', 'clean:false']));
    });

    it('shows "Cleaning..." and disables the button while cleaning', () => {
      renderModal({ ...withMissing(), isCleaningGhostRecords: true });
      const button = screen.getByRole('button', { name: /Cleaning/ });
      expect(button.disabled).toBe(true);
    });
  });

  describe('body states', () => {
    it('shows a spinner while fetching', () => {
      renderModal({ isFetchingFolderContents: true });
      expect(screen.getByText('Scanning folder contents...')).toBeTruthy();
    });

    it.each([
      ['no contents yet', { folderContents: null }],
      ['an empty folder', { folderContents: makeContents({ items: [] }) }],
    ])('shows the empty state for %s', (_label, overrides) => {
      renderModal(overrides);
      expect(screen.getByText('No supported media found')).toBeTruthy();
    });

    it('shows the truncated notice', () => {
      renderModal({ folderContents: makeContents({ truncated: true, limit: 1234 }) });
      expect(screen.getByText('Showing the first 1234 files. The folder contains more supported media.')).toBeTruthy();
    });
  });

  describe('visible limit', () => {
    it('renders only folderVisibleLimit rows and offers to load the rest', () => {
      const { props } = renderModal({ folderVisibleLimit: 2 });
      expect(screen.getAllByText(/^item\d\.jpg$/)).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: 'Load more (3 remaining)' }));
      const updater = props.setFolderVisibleLimit.mock.calls[0][0];
      expect(updater(2)).toBe(5);
      expect(updater(0)).toBe(5);
    });

    it('adds 100 per load-more click when many items remain', () => {
      const { props } = renderModal({ folderContents: makeContents({ items: makeItems(500) }), folderVisibleLimit: 60 });
      fireEvent.click(screen.getByRole('button', { name: 'Load more (440 remaining)' }));
      expect(props.setFolderVisibleLimit.mock.calls[0][0](60)).toBe(160);
    });

    it('hides load more when all rows are visible', () => {
      renderModal();
      expect(screen.queryByText(/Load more/)).toBeNull();
    });

    const scrollContainer = (container) => container.querySelector('.overflow-y-auto.flex-1');
    const setScroll = (el, { scrollHeight, scrollTop, clientHeight }) => {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
      Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
    };

    it('loads 40 more rows when scrolled near the bottom', () => {
      const { props, container } = renderModal({
        folderContents: makeContents({ items: makeItems(200) }), folderVisibleLimit: 60,
      });
      const el = scrollContainer(container);
      setScroll(el, { scrollHeight: 1000, scrollTop: 500, clientHeight: 400 });
      fireEvent.scroll(el);

      expect(props.setFolderVisibleLimit).toHaveBeenCalledTimes(1);
      const updater = props.setFolderVisibleLimit.mock.calls[0][0];
      expect(updater(60)).toBe(100);
      expect(updater(190)).toBe(200);
    });

    it('does nothing when scrolled far from the bottom', () => {
      const { props, container } = renderModal({
        folderContents: makeContents({ items: makeItems(200) }), folderVisibleLimit: 60,
      });
      const el = scrollContainer(container);
      setScroll(el, { scrollHeight: 2000, scrollTop: 0, clientHeight: 400 });
      fireEvent.scroll(el);
      expect(props.setFolderVisibleLimit).not.toHaveBeenCalled();
    });
  });

  it('opens a row preview in the lightbox', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('item0.jpg'));
    expect(props.setSelectedImage).toHaveBeenCalledWith(expect.objectContaining({
      path: '/photos/item0.jpg', isBrowsing: true, timestamp_seconds: 0,
    }));
  });

  it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
    renderModal({ uiTheme });
    expect(screen.getByText('Folder Contents')).toBeTruthy();
  });
});
