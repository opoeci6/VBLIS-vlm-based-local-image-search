import { describe, expect, it } from 'vitest';
import { getAllSelectablePaths, toggleFolderSelection } from './folderSelection';

const root = {
  path: '/root',
  subfolders: [{ path: '/root/a' }, { path: '/root/b' }],
};

describe('toggleFolderSelection', () => {
  it('selects a root folder together with all its subfolders, then deselects them all', () => {
    const selected = toggleFolderSelection([], '/root', false, root);
    expect([...selected].sort()).toEqual(['/root', '/root/a', '/root/b']);

    const cleared = toggleFolderSelection(selected, '/root', false, root);
    expect(cleared).toEqual([]);
  });

  it('keeps unrelated selections when toggling a root', () => {
    const selected = toggleFolderSelection(['/other'], '/root', false, root);
    expect(selected).toEqual(['/other', '/root', '/root/a', '/root/b']);
    expect(toggleFolderSelection(selected, '/root', false, root)).toEqual(['/other']);
  });

  it('toggles a root without subfolders on its own', () => {
    const lone = { path: '/lone' };
    expect(toggleFolderSelection([], '/lone', false, lone)).toEqual(['/lone']);
    expect(toggleFolderSelection(['/lone'], '/lone', false, lone)).toEqual([]);
    expect(toggleFolderSelection([], '/lone', false, null)).toEqual(['/lone']);
  });

  it('toggles a subfolder node together with its descendants', () => {
    const node = { path: '/root/a', descendantPaths: ['/root/a/x', '/root/a/y'] };
    const selected = toggleFolderSelection(['/root'], '/root/a', true, node);
    expect(selected).toEqual(['/root', '/root/a', '/root/a/x', '/root/a/y']);
    expect(toggleFolderSelection(selected, '/root/a', true, node)).toEqual(['/root']);
  });

  it('toggles a leaf subfolder (empty descendantPaths) on its own', () => {
    const leaf = { path: '/root/a', descendantPaths: [] };
    expect(toggleFolderSelection(['/root'], '/root/a', true, leaf)).toEqual(['/root', '/root/a']);
    expect(toggleFolderSelection(['/root', '/root/a'], '/root/a', true, leaf)).toEqual(['/root']);
  });

  it('counts a parent as selected when all children are selected even if the parent is not', () => {
    const node = { path: '/root/a', descendantPaths: ['/root/a/x', '/root/a/y'] };
    const result = toggleFolderSelection(['/root/a/x', '/root/a/y', '/keep'], '/root/a', true, node);
    expect(result).toEqual(['/keep']);
  });

  it('selects when only some children are selected and the parent is not', () => {
    const node = { path: '/root/a', descendantPaths: ['/root/a/x', '/root/a/y'] };
    const result = toggleFolderSelection(['/root/a/x'], '/root/a', true, node);
    expect([...result].sort()).toEqual(['/root/a', '/root/a/x', '/root/a/y']);
  });

  it('deselects everything when the parent itself is selected', () => {
    const result = toggleFolderSelection(['/root', '/root/a'], '/root', false, root);
    expect(result).toEqual([]);
  });

  it('does not create duplicates on select', () => {
    const result = toggleFolderSelection(['/root/a'], '/root', false, root);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it('does not mutate the previous selection', () => {
    const prev = ['/root/a'];
    toggleFolderSelection(prev, '/root', false, root);
    expect(prev).toEqual(['/root/a']);
  });
});

describe('getAllSelectablePaths', () => {
  it('flattens roots and their subfolders', () => {
    expect(getAllSelectablePaths([
      root,
      { path: '/second', subfolders: [{ path: '/second/c' }] },
    ])).toEqual(['/root', '/root/a', '/root/b', '/second', '/second/c']);
  });

  it('handles a missing subfolders key and an empty list', () => {
    expect(getAllSelectablePaths([{ path: '/solo' }])).toEqual(['/solo']);
    expect(getAllSelectablePaths([])).toEqual([]);
  });
});
