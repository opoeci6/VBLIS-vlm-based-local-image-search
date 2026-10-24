import { describe, expect, it } from 'vitest';
import { buildSubfolderTree, getRelativeSegment } from './folderTree';

describe('getRelativeSegment', () => {
  it('returns the basename when there is no parent', () => {
    expect(getRelativeSegment('/a/b/c')).toBe('c');
    expect(getRelativeSegment('C:\\a\\b\\c', null)).toBe('c');
  });

  it('returns a breadcrumb for a nested child', () => {
    expect(getRelativeSegment('/root/a/b', '/root')).toBe('a / b');
    expect(getRelativeSegment('C:\\root\\a\\b', 'C:\\root')).toBe('a / b');
  });

  it('matches the parent prefix case-insensitively and across separator styles', () => {
    expect(getRelativeSegment('C:\\Root\\Sub\\Deep', 'c:/root')).toBe('Sub / Deep');
  });

  it('falls back to the basename when the child is not under the parent', () => {
    expect(getRelativeSegment('/other/place/x', '/root')).toBe('x');
  });

  it('falls back to the basename when the child equals the parent', () => {
    expect(getRelativeSegment('/root', '/root')).toBe('root');
  });
});

describe('buildSubfolderTree', () => {
  it('returns [] for empty or missing subfolders', () => {
    expect(buildSubfolderTree([], '/root')).toEqual([]);
    expect(buildSubfolderTree(null, '/root')).toEqual([]);
    expect(buildSubfolderTree(undefined, '/root')).toEqual([]);
  });

  it('builds a flat list of root children sorted by name', () => {
    const tree = buildSubfolderTree([
      { path: '/root/zeta', depth: 1, image_count: 2, video_count: 0 },
      { path: '/root/alpha', depth: 1, image_count: 1, video_count: 3 },
    ], '/root');
    expect(tree.map(n => n.name)).toEqual(['alpha', 'zeta']);
    expect(tree[0]).toMatchObject({
      path: '/root/alpha',
      children: [],
      descendantPaths: [],
      direct_image_count: 1,
      direct_video_count: 3,
      total_image_count: 1,
      total_video_count: 3,
    });
  });

  it('nests children under intermediate nodes and aggregates counts and descendantPaths', () => {
    const tree = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 1, video_count: 0 },
      { path: '/root/a/b', depth: 2, image_count: 2, video_count: 0 },
      { path: '/root/a/c', depth: 2, image_count: 0, video_count: 4 },
    ], '/root');
    expect(tree).toHaveLength(1);
    const a = tree[0];
    expect(a.name).toBe('a');
    expect(a.children.map(c => c.path)).toEqual(['/root/a/b', '/root/a/c']);
    expect(a.children.map(c => c.name)).toEqual(['b', 'c']);
    expect(a.descendantPaths).toEqual(['/root/a/b', '/root/a/c']);
    expect(a.total_image_count).toBe(3);
    expect(a.total_video_count).toBe(4);
    expect(a.direct_image_count).toBe(1);
  });

  it('uses the root-relative path for a nested subfolder whose parent is not listed', () => {
    const tree = buildSubfolderTree([
      { path: '/root/x/y', depth: 2, image_count: 5, video_count: 0 },
    ], '/root');
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('x / y');
    expect(tree[0].path).toBe('/root/x/y');
  });

  it('attaches to the nearest listed ancestor and names the segment relative to it', () => {
    const tree = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 1, video_count: 0 },
      { path: '/root/a/m/n', depth: 3, image_count: 2, video_count: 0 },
    ], '/root');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('m / n');
    expect(tree[0].descendantPaths).toEqual(['/root/a/m/n']);
  });

  it('compacts a node with no direct items and exactly one child into that child', () => {
    const tree = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 0, video_count: 0 },
      { path: '/root/a/b', depth: 2, image_count: 3, video_count: 1 },
    ], '/root');
    expect(tree).toHaveLength(1);
    const node = tree[0];
    expect(node.name).toBe('a / b');
    expect(node.path).toBe('/root/a/b');
    expect(node.direct_image_count).toBe(3);
    expect(node.direct_video_count).toBe(1);
    expect(node.total_image_count).toBe(3);
    expect(node.children).toEqual([]);
    expect(node.descendantPaths).toEqual([]);
  });

  it('compacts a chain of empty single-child nodes', () => {
    const tree = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 0, video_count: 0 },
      { path: '/root/a/b', depth: 2, image_count: 0, video_count: 0 },
      { path: '/root/a/b/c', depth: 3, image_count: 2, video_count: 0 },
    ], '/root');
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('a / b / c');
    expect(tree[0].path).toBe('/root/a/b/c');
    expect(tree[0].children).toEqual([]);
  });

  it('does not compact when the node has direct items or multiple children', () => {
    const withItems = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 1, video_count: 0 },
      { path: '/root/a/b', depth: 2, image_count: 1, video_count: 0 },
    ], '/root');
    expect(withItems[0].path).toBe('/root/a');
    expect(withItems[0].children).toHaveLength(1);

    const twoChildren = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 0, video_count: 0 },
      { path: '/root/a/b', depth: 2, image_count: 1, video_count: 0 },
      { path: '/root/a/c', depth: 2, image_count: 1, video_count: 0 },
    ], '/root');
    expect(twoChildren[0].path).toBe('/root/a');
    expect(twoChildren[0].children).toHaveLength(2);
  });

  it('works with Windows separators', () => {
    const tree = buildSubfolderTree([
      { path: 'C:\\root\\a', depth: 1, image_count: 1, video_count: 0 },
      { path: 'C:\\root\\a\\b', depth: 2, image_count: 1, video_count: 0 },
    ], 'C:\\root');
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('a');
    expect(tree[0].children[0].name).toBe('b');
    expect(tree[0].descendantPaths).toEqual(['C:\\root\\a\\b']);
  });

  it('falls back disk counts to the item counts', () => {
    const [node] = buildSubfolderTree([
      { path: '/root/a', depth: 1, image_count: 4, video_count: 2 },
    ], '/root');
    expect(node).toMatchObject({
      direct_disk_image_count: 4,
      direct_disk_video_count: 2,
      disk_image_count: 4,
      disk_video_count: 2,
    });
  });
});
