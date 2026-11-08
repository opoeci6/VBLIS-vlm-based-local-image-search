import { getFileName } from './media';

export const annotateDuplicates = (dataResults) => {
  const results = dataResults || [];
  if (results.length === 0) return [];

  // Helper: Fast dot product for normalized vectors
  const vectorDot = (a, b) => {
    if (!a || !b || a.length !== b.length) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  };

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

  // 2. Pairwise Cosine Similarity for Visual Duplicates (Threshold >= 0.985)
  // Run full pairwise on the top image results (up to 800) to keep JS thread non-blocking for 4k+ sets.
  // Video frames are skipped (and carry no embedding), so they must not eat into that budget.
  const VISUAL_THRESHOLD = 0.985;
  // Union-find over result indices so that similarity chains merge into one group
  const parent = new Map(); // index -> parent index; only indices in a similar pair are present
  const findRoot = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  const candidateIndices = [];
  for (let i = 0; i < results.length && candidateIndices.length < 800; i++) {
    if (results[i].media_type !== 'video') candidateIndices.push(i);
  }

  for (let a = 0; a < candidateIndices.length; a++) {
    const i = candidateIndices[a];
    const itemA = results[i];
    if (!itemA.embedding) continue;

    for (let b = a + 1; b < candidateIndices.length; b++) {
      const j = candidateIndices[b];
      const itemB = results[j];
      if (!itemB.embedding) continue;

      // Skip if already exact hash match
      if (itemA.hash && itemB.hash && itemA.hash === itemB.hash) continue;

      const sim = vectorDot(itemA.embedding, itemB.embedding);
      if (sim >= VISUAL_THRESHOLD) {
        union(i, j);
      }
    }
  }

  // Color Palettes
  const exactColors = ['#0078d4', '#ec4899', '#10b981', '#f59e0b']; // System blue / Pink / Emerald / Amber
  const visualColors = ['#f59e0b', '#10b981', '#f97316', '#eab308']; // Amber / Emerald / Orange / Yellow

  const exactColorMap = {};
  let exactIdx = 0;
  exactDupeHashes.forEach(h => {
    exactColorMap[h] = exactColors[exactIdx % exactColors.length];
    exactIdx++;
  });

  // Connected components, ordered by smallest member index (Map preserves insertion order
  // and indices are visited ascending, so each component is created at its smallest member).
  const componentsByRoot = new Map();
  Array.from(parent.keys()).sort((a, b) => a - b).forEach(idx => {
    const root = findRoot(idx);
    if (!componentsByRoot.has(root)) componentsByRoot.set(root, []);
    componentsByRoot.get(root).push(idx);
  });
  const visualGroups = Array.from(componentsByRoot.values());

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

  // 3. Map final enhanced result objects (strip heavy raw embeddings to save memory)
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

    const { embedding, copies, ...cleanRes } = res;

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
