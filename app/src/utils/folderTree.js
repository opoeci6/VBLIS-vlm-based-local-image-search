/**
 * Computes the relative path display label from parent to child,
 * converting path separators into clean breadcrumb dividers (" / ").
 */
export function getRelativeSegment(childPath, parentPath) {
  if (!parentPath) return childPath.split(/[\\/]/).pop() || childPath;
  const normalizedChild = childPath.replace(/[\\/]+/g, '/');
  const normalizedParent = parentPath.replace(/[\\/]+/g, '/');

  if (normalizedChild.toLowerCase().startsWith(normalizedParent.toLowerCase())) {
    const rel = normalizedChild.slice(normalizedParent.length).replace(/^\/+/, '');
    if (rel) {
      return rel.replace(/\//g, ' / ');
    }
  }
  return childPath.split(/[\\/]/).pop() || childPath;
}

/**
 * Builds a hierarchical tree from a flat list of subfolders under a root folder,
 * preserving intermediate folder names and chain-compacting single-child paths.
 */
export function buildSubfolderTree(subfolders, rootPath) {
  if (!subfolders || subfolders.length === 0) return [];

  const nodeMap = new Map();

  subfolders.forEach((sub) => {
    nodeMap.set(sub.path, {
      ...sub,
      direct_image_count: sub.image_count || 0,
      direct_video_count: sub.video_count || 0,
      total_image_count: sub.image_count || 0,
      total_video_count: sub.video_count || 0,
      direct_disk_image_count: sub.direct_disk_image_count || sub.image_count || 0,
      direct_disk_video_count: sub.direct_disk_video_count || sub.video_count || 0,
      disk_image_count: sub.disk_image_count || sub.image_count || 0,
      disk_video_count: sub.disk_video_count || sub.video_count || 0,
      children: [],
      descendantPaths: []
    });
  });

  const rootChildren = [];
  const sortedSubs = [...subfolders].sort((a, b) => (a.depth || 1) - (b.depth || 1));

  sortedSubs.forEach((sub) => {
    const node = nodeMap.get(sub.path);
    let parentPath = null;
    let currentDir = sub.path;

    while (true) {
      const parentDir =
        currentDir.split(/[\\/]/).slice(0, -1).join(currentDir.includes('/') ? '/' : '\\') || '';
      if (!parentDir || parentDir === currentDir) break;
      if (nodeMap.has(parentDir)) {
        parentPath = parentDir;
        break;
      }
      if (parentDir.toLowerCase() === rootPath.toLowerCase()) {
        break;
      }
      currentDir = parentDir;
    }

    if (parentPath && nodeMap.has(parentPath)) {
      node.name = getRelativeSegment(node.path, parentPath);
      nodeMap.get(parentPath).children.push(node);
    } else {
      node.name = getRelativeSegment(node.path, rootPath);
      rootChildren.push(node);
    }
  });

  function processNode(node) {
    const childDescendants = [];
    let childImages = 0;
    let childVideos = 0;
    let childDiskImages = 0;
    let childDiskVideos = 0;

    node.children.forEach((child) => {
      processNode(child);
      childDescendants.push(child.path, ...child.descendantPaths);
      childImages += child.total_image_count;
      childVideos += child.total_video_count;
      childDiskImages += child.disk_image_count;
      childDiskVideos += child.disk_video_count;
    });

    node.descendantPaths = childDescendants;
    node.total_image_count = node.direct_image_count + childImages;
    node.total_video_count = node.direct_video_count + childVideos;
    node.disk_image_count = node.direct_disk_image_count + childDiskImages;
    node.disk_video_count = node.direct_disk_video_count + childDiskVideos;

    // Chain Compaction: If intermediate node has 0 direct items & exactly 1 child, compact names
    if (
      node.direct_image_count === 0 &&
      node.direct_video_count === 0 &&
      node.children.length === 1
    ) {
      const onlyChild = node.children[0];
      node.name = `${node.name} / ${onlyChild.name}`;
      node.path = onlyChild.path;
      node.relative_path = onlyChild.relative_path;
      node.exists = onlyChild.exists;
      node.direct_image_count = onlyChild.direct_image_count;
      node.direct_video_count = onlyChild.direct_video_count;
      node.total_image_count = onlyChild.total_image_count;
      node.total_video_count = onlyChild.total_video_count;
      node.disk_image_count = onlyChild.disk_image_count;
      node.disk_video_count = onlyChild.disk_video_count;
      node.children = onlyChild.children;
      node.descendantPaths = onlyChild.descendantPaths;
    }

    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  rootChildren.forEach((rootChild) => processNode(rootChild));
  rootChildren.sort((a, b) => a.name.localeCompare(b.name));

  return rootChildren;
}
