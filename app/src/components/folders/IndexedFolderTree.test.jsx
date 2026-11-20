import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IndexedFolderTree } from './IndexedFolderTree';

const makeFolder = () => ({
  path: '/root',
  name: 'root',
  exists: true,
  image_count: 3,
  video_count: 0,
  subfolder_count: 2,
  subfolders: [
    { path: '/root/alpha', depth: 1, image_count: 1, video_count: 0, exists: true },
    { path: '/root/beta', depth: 1, image_count: 2, video_count: 0, exists: true },
  ],
});

const renderTree = (props = {}) => render(
  <IndexedFolderTree
    folders={[makeFolder()]}
    selectedPaths={[]}
    onToggleSelection={() => {}}
    onBrowse={() => {}}
    onReindex={() => {}}
    onDelete={() => {}}
    {...props}
  />
);

describe('IndexedFolderTree', () => {
  afterEach(cleanup);

  it('renders the root and (expanded by default) both subfolder labels', () => {
    renderTree();
    expect(screen.getByText('root')).toBeTruthy();
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  it('calls onToggleSelection(rootPath, false, folder) from the root checkbox', () => {
    const onToggleSelection = vi.fn();
    renderTree({ onToggleSelection });

    // Subfolder nodes can share this title; the root's checkbox comes first in the DOM.
    fireEvent.click(screen.getAllByTitle('Select folder and subfolders')[0]);
    expect(onToggleSelection).toHaveBeenCalledTimes(1);
    const [path, isSubfolder, folder] = onToggleSelection.mock.calls[0];
    expect(path).toBe('/root');
    expect(isSubfolder).toBe(false);
    expect(folder.path).toBe('/root');
    expect(folder.subfolders.map(s => s.path)).toEqual(['/root/alpha', '/root/beta']);
  });

  it('collapses the subfolders via the root expand button', () => {
    renderTree();
    fireEvent.click(screen.getByTitle('Collapse subfolders'));
    expect(screen.queryByText('alpha')).toBeNull();
    fireEvent.click(screen.getByTitle('Expand subfolders'));
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('names the icon buttons of the root and of a subfolder', () => {
    renderTree();
    // Subfolders show the same actions as the root, so each name appears for the root and for both subfolders.
    expect(screen.getAllByRole('button', { name: 'Select folder and subfolders' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Collapse subfolders' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'View media gallery & contents' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Re-sync only this subfolder' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete only this subfolder from index' }).length).toBeGreaterThan(0);
  });

  it('renders in the terminal theme', () => {
    renderTree({ uiTheme: 'terminal' });
    expect(screen.getByText('root')).toBeTruthy();
  });
});
