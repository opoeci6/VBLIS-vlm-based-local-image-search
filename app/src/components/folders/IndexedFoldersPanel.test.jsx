import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IndexedFoldersPanel } from './IndexedFoldersPanel';

const folder = (path, extra = {}) => ({
  path,
  name: path.split('/').pop(),
  exists: true,
  image_count: 2,
  video_count: 0,
  subfolder_count: 0,
  subfolders: [],
  ...extra,
});

const makeProps = (overrides = {}) => ({
  isFoldersExpanded: false,
  setIsFoldersExpanded: vi.fn(),
  suppressCollapse: false,
  indexedFolders: [folder('/photos'), folder('/videos')],
  isFetchingFolders: false,
  selectedFolders: [],
  allSelectableFolderPaths: ['/photos', '/videos'],
  toggleSelectAll: vi.fn(),
  toggleFolderSelection: vi.fn(),
  isBatchProcessing: false,
  handleBatchReindex: vi.fn(),
  handleBatchDelete: vi.fn(),
  handleOpenFolder: vi.fn(),
  handleBrowseFolderContents: vi.fn(),
  handleReindexFolder: vi.fn(),
  handleDeleteFolderIndex: vi.fn(),
  status: { is_indexing: false },
  uiTheme: 'modern',
  ...overrides,
});

const renderPanel = (overrides) => {
  const props = makeProps(overrides);
  return { props, ...render(<IndexedFoldersPanel {...props} />) };
};

const addOutside = (tag = 'div') => {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
};

describe('IndexedFoldersPanel', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  describe('header', () => {
    it('shows the folder count and the collapsed hint', () => {
      renderPanel();
      expect(screen.getByText('Indexed Folders')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('Click to view and manage indexed folders')).toBeTruthy();
      expect(screen.queryByText('Select All')).toBeNull();
    });

    it('toggles expansion from the header and from the chevron', () => {
      const { props } = renderPanel();
      fireEvent.click(screen.getByText('Indexed Folders'));
      expect(props.setIsFoldersExpanded).toHaveBeenCalledTimes(1);
      const updater = props.setIsFoldersExpanded.mock.calls[0][0];
      expect(updater(false)).toBe(true);
      expect(updater(true)).toBe(false);

      fireEvent.click(screen.getByTitle('Expand folders'));
      expect(props.setIsFoldersExpanded).toHaveBeenCalledTimes(2);
    });

    it('Add Folder(s) calls handleOpenFolder without toggling', () => {
      const { props } = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /Add Folder\(s\)/ }));
      expect(props.handleOpenFolder).toHaveBeenCalledTimes(1);
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });
  });

  describe('expanded body', () => {
    it('lists the folders and wires Select All', () => {
      const { props } = renderPanel({ isFoldersExpanded: true });
      expect(screen.getByText('photos')).toBeTruthy();
      expect(screen.getByText('videos')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Select All/ }));
      expect(props.toggleSelectAll).toHaveBeenCalledTimes(1);
    });

    it('shows Deselect All when everything is selected', () => {
      renderPanel({ isFoldersExpanded: true, selectedFolders: ['/photos', '/videos'] });
      expect(screen.getByRole('button', { name: /Deselect All/ })).toBeTruthy();
      expect(screen.getByText('2 SELECTED')).toBeTruthy();
    });

    it('wires the batch buttons', () => {
      const { props } = renderPanel({ isFoldersExpanded: true, selectedFolders: ['/photos'] });
      fireEvent.click(screen.getByRole('button', { name: 'Reindex' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(props.handleBatchReindex).toHaveBeenCalledTimes(1);
      expect(props.handleBatchDelete).toHaveBeenCalledTimes(1);
    });

    it('disables the batch buttons while indexing or processing', () => {
      const { unmount } = renderPanel({
        isFoldersExpanded: true, selectedFolders: ['/photos'], status: { is_indexing: true },
      });
      expect(screen.getByRole('button', { name: 'Reindex' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Delete' }).disabled).toBe(true);
      unmount();

      renderPanel({ isFoldersExpanded: true, selectedFolders: ['/photos'], isBatchProcessing: true });
      expect(screen.getByRole('button', { name: 'Reindex' }).disabled).toBe(true);
    });

    it('hints at batch actions with no selection', () => {
      renderPanel({ isFoldersExpanded: true });
      expect(screen.getByText('Select folders for batch actions')).toBeTruthy();
    });

    it('shows the empty state', () => {
      renderPanel({ isFoldersExpanded: true, indexedFolders: [], allSelectableFolderPaths: [] });
      expect(screen.getByText('No folders selected')).toBeTruthy();
      expect(screen.queryByText('Select All')).toBeNull();
    });

    it('shows the loading state while fetching with no folders', () => {
      renderPanel({ isFoldersExpanded: true, indexedFolders: [], isFetchingFolders: true });
      expect(screen.getByText('Fetching folders...')).toBeTruthy();
    });
  });

  describe('click outside', () => {
    it('collapses on a mousedown outside the panel', () => {
      const { props } = renderPanel({ isFoldersExpanded: true });
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).toHaveBeenCalledWith(false);
    });

    it('does nothing when collapsed', () => {
      const { props } = renderPanel({ isFoldersExpanded: false });
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });

    it('does not collapse while an overlay is open (suppressCollapse)', () => {
      const { props } = renderPanel({ isFoldersExpanded: true, suppressCollapse: true });
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });

    it('does not collapse for clicks on buttons, inputs or [data-no-collapse] elements', () => {
      const { props } = renderPanel({ isFoldersExpanded: true });
      fireEvent.mouseDown(addOutside('button'));
      fireEvent.mouseDown(addOutside('input'));
      const marked = addOutside();
      marked.setAttribute('data-no-collapse', '');
      fireEvent.mouseDown(marked);
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });

    it('does not collapse for clicks inside the panel', () => {
      const { props } = renderPanel({ isFoldersExpanded: true });
      fireEvent.mouseDown(screen.getByText('Indexed Folders'));
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });

    it('stops listening after unmount', () => {
      const { props, unmount } = renderPanel({ isFoldersExpanded: true });
      unmount();
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();
    });

    it('reacts to suppressCollapse changing', () => {
      const props = makeProps({ isFoldersExpanded: true, suppressCollapse: true });
      const { rerender } = render(<IndexedFoldersPanel {...props} />);
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).not.toHaveBeenCalled();

      rerender(<IndexedFoldersPanel {...props} suppressCollapse={false} />);
      fireEvent.mouseDown(addOutside());
      expect(props.setIsFoldersExpanded).toHaveBeenCalledWith(false);
    });
  });
});
