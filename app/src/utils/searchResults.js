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

  // 2. Visual duplicates: the backend numbers each group of near-identical images (`visual_group`) on the
  // images it checked. Members are collected in result order, so groups are ordered by their first member.
  // Videos are never tagged.
  const visualMembers = new Map(); // visual_group -> result indices
  results.forEach((res, idx) => {
    if (res.media_type === 'video' || !Number.isInteger(res.visual_group)) return;
    if (!visualMembers.has(res.visual_group)) visualMembers.set(res.visual_group, []);
    visualMembers.get(res.visual_group).push(idx);
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

  const visualGroups = Array.from(visualMembers.values()).filter(indices => indices.length > 1);

  const visualColorMap = new Map();
  const visualPathsMap = new Map();
  visualGroups.forEach((indices, gIdx) => {
    const color = visualColors[gIdx % visualColors.length];
    const paths = indices.map(idx => results[idx].path);
    indices.forEach(idx => {
      visualColorMap.set(idx, color);
      visualPathsMap.set(idx, paths.filter(p => p !== results[idx].path));
    });
  });

  // 3. Map final enhanced result objects (the raw backend fields they were built from are dropped)
  return results.map((res, idx) => {
    const isExact = !!(res.hash && exactDupeHashes.has(res.hash));
    const isVisual = !isExact && visualColorMap.has(idx);

    let duplicateType = null;
    let dupeColor = null;
    let otherPaths = [];

    if (isExact) {
      duplicateType = 'exact';
      dupeColor = exactColorMap[res.hash];
      otherPaths = Array.from(exactHashGroups[res.hash]).filter(p => p !== res.path);
    } else if (isVisual) {
      duplicateType = 'visual';
      dupeColor = visualColorMap.get(idx);
      otherPaths = visualPathsMap.get(idx) || [];
    }

    const { embedding, copies, visual_group, ...cleanRes } = res;

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
