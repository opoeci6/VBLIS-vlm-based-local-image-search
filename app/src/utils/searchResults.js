import { getFileName } from './media';

export const annotateDuplicates = (dataResults) => {
  const results = dataResults || [];
  if (results.length === 0) return [];

  // 1. Group exact file duplicates by SHA-256 hash. The group of a hash holds the paths of the results with
  // that hash and every copy the backend found in the whole library (`copies`, only on the leading results),
  // each path once, in order of first appearance. A hash is an exact duplicate when its group has 2+ paths.
  const exactHashGroups = {};
  results.forEach(res => {
    if (res.media_type !== 'video' && res.hash) {
      if (!exactHashGroups[res.hash]) exactHashGroups[res.hash] = new Set();
      const group = exactHashGroups[res.hash];
      group.add(res.path);
      (res.copies || []).forEach(copyPath => group.add(copyPath));
    }
  });

  const exactDupeHashes = new Set(
    Object.keys(exactHashGroups).filter(h => exactHashGroups[h].size > 1)
  );

  // 2. Visual duplicates: an image result lists the other library paths that look near-identical
  // (`visual_copies`, only on the leading image results). Results and listed paths are joined into
  // groups (union-find), so two results that list each other or a shared path end up in one group.
  // Videos are never tagged.
  const parent = new Map();
  const find = (path) => {
    if (!parent.has(path)) parent.set(path, path);
    let root = path;
    while (parent.get(root) !== root) root = parent.get(root);
    let node = path;
    while (parent.get(node) !== root) {
      const next = parent.get(node);
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (first, second) => {
    const a = find(first);
    const b = find(second);
    if (a !== b) parent.set(b, a);
  };
  results.forEach(res => {
    if (res.media_type === 'video') return;
    find(res.path);
    (res.visual_copies || []).forEach(copyPath => union(res.path, copyPath));
  });

  // Paths of each group (the results and every listed copy), each once, in order of first appearance.
  const visualPaths = new Map(); // root -> Set of paths
  results.forEach(res => {
    if (res.media_type === 'video') return;
    const root = find(res.path);
    if (!visualPaths.has(root)) visualPaths.set(root, new Set());
    const group = visualPaths.get(root);
    group.add(res.path);
    (res.visual_copies || []).forEach(copyPath => group.add(copyPath));
  });

  // Color Palettes
  const exactColors = ['#0078d4', '#ec4899', '#10b981', '#f59e0b']; // System blue / Pink / Emerald / Amber
  const visualColors = ['#f59e0b', '#10b981', '#f97316', '#eab308']; // Amber / Emerald / Orange / Yellow

  const exactColorMap = {};
  let exactIdx = 0;
  exactDupeHashes.forEach(h => {
    exactColorMap[h] = exactColors[exactIdx % exactColors.length];
    exactIdx++;
  });

  // Groups with another path in them are visual duplicates; colors follow the order of each group's first result.
  const visualRootColors = new Map();
  results.forEach(res => {
    if (res.media_type === 'video') return;
    const root = find(res.path);
    if (visualRootColors.has(root) || visualPaths.get(root).size < 2) return;
    visualRootColors.set(root, visualColors[visualRootColors.size % visualColors.length]);
  });

  // 3. Map final enhanced result objects (the raw backend fields they were built from are dropped)
  return results.map(res => {
    const isExact = !!(res.hash && exactDupeHashes.has(res.hash));
    const visualRoot = res.media_type === 'video' ? null : find(res.path);
    const isVisual = !isExact && visualRoot !== null && visualRootColors.has(visualRoot);

    let duplicateType = null;
    let dupeColor = null;
    let otherPaths = [];

    if (isExact) {
      duplicateType = 'exact';
      dupeColor = exactColorMap[res.hash];
      otherPaths = Array.from(exactHashGroups[res.hash]).filter(p => p !== res.path);
    } else if (isVisual) {
      duplicateType = 'visual';
      dupeColor = visualRootColors.get(visualRoot);
      otherPaths = Array.from(visualPaths.get(visualRoot)).filter(p => p !== res.path);
    }

    const { embedding, copies, visual_copies, visual_group, ...cleanRes } = res;

    return {
      ...cleanRes,
      isDuplicate: isExact || isVisual,
      duplicateType: duplicateType, // 'exact' | 'visual' | null
      dupeColor: dupeColor,
      otherPaths: otherPaths
    };
  });
};

const frameKey = (frame) => frame.id ?? `${frame.path}:${frame.timestamp_seconds}`;

// `expandedFramesByPath` maps a video path to `{ frames, totalFrames }` fetched by "Find more
// frames"; those frames are merged into the group of the same path. Group order always follows
// the frames of `results` itself, so expanding a video never reorders the grid.
export const groupVideoResults = (results, expandedFramesByPath = {}) => {
  const groupsByPath = new Map();

  results.forEach(frame => {
    if (frame.media_type !== 'video') return;

    const existingGroup = groupsByPath.get(frame.path);
    if (existingGroup) {
      existingGroup.frames.push(frame);
      if ((frame.score || 0) > existingGroup.bestScore) {
        existingGroup.bestScore = frame.score || 0;
        existingGroup.bestFrame = frame;
      }
      return;
    }

    groupsByPath.set(frame.path, {
      path: frame.path,
      name: getFileName(frame.path) || frame.path,
      frames: [frame],
      bestScore: frame.score || 0,
      bestFrame: frame
    });
  });

  return Array.from(groupsByPath.values())
    .map(group => {
      const searchBestScore = group.bestScore;
      const expansion = expandedFramesByPath[group.path];
      let { frames, bestScore, bestFrame } = group;
      if (expansion) {
        const seen = new Set(frames.map(frameKey));
        frames = [...frames];
        (expansion.frames || []).forEach(frame => {
          const key = frameKey(frame);
          if (seen.has(key)) return;
          seen.add(key);
          frames.push(frame);
          if ((frame.score || 0) > bestScore) {
            bestScore = frame.score || 0;
            bestFrame = frame;
          }
        });
      }
      return {
        ...group,
        bestScore,
        bestFrame,
        searchBestScore,
        totalFrames: expansion ? (expansion.totalFrames ?? null) : null,
        isExpanded: Boolean(expansion),
        frames: [...frames].sort(
          (first, second) => {
            const scoreDifference = (second.score || 0) - (first.score || 0);
            if (scoreDifference !== 0) return scoreDifference;
            return (first.timestamp_seconds || 0) - (second.timestamp_seconds || 0);
          }
        )
      };
    })
    .sort((first, second) => second.searchBestScore - first.searchBestScore)
    .map(({ searchBestScore, ...group }) => group);
};

export const getImageResults = (results) => results.filter(result => result.media_type !== 'video');

// Number of results the way Max Results counts them: every image, and every video once.
export const countSearchResults = (results) => {
  const videoPaths = new Set();
  let count = 0;
  (results || []).forEach(result => {
    if (result.media_type === 'video') videoPaths.add(result.path);
    else count += 1;
  });
  return count + videoPaths.size;
};
