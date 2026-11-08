import { describe, expect, it } from 'vitest';
import { annotateDuplicates, countSearchResults, getImageResults, groupVideoResults } from './searchResults';

const img = (path, extra = {}) => ({ path, media_type: 'image', score: 0.5, ...extra });

describe('annotateDuplicates', () => {
  it('returns [] for empty, null and undefined input', () => {
    expect(annotateDuplicates([])).toEqual([]);
    expect(annotateDuplicates(null)).toEqual([]);
    expect(annotateDuplicates(undefined)).toEqual([]);
  });

  it('tags images sharing a hash as exact duplicates', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { hash: 'h1' }),
      img('/b.jpg', { hash: 'h1' }),
      img('/c.jpg', { hash: 'h2' }),
    ]);
    expect(out[0]).toMatchObject({ isDuplicate: true, duplicateType: 'exact', otherPaths: ['/b.jpg'] });
    expect(out[1]).toMatchObject({ isDuplicate: true, duplicateType: 'exact', otherPaths: ['/a.jpg'] });
    expect(out[0].dupeColor).toBe('#0078d4');
    expect(out[1].dupeColor).toBe(out[0].dupeColor);
    expect(out[2]).toMatchObject({ isDuplicate: false, duplicateType: null, dupeColor: null, otherPaths: [] });
  });

  describe('exact copies from the whole library', () => {
    it('treats a single result with copies as exact, otherPaths being the copies', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', copies: ['/e/a.jpg', '/f/a.jpg'] }),
        img('/b.jpg', { hash: 'h2', copies: [] }),
      ]);
      expect(out[0]).toMatchObject({
        isDuplicate: true, duplicateType: 'exact', otherPaths: ['/e/a.jpg', '/f/a.jpg'], dupeColor: '#0078d4',
      });
      expect(out[1]).toMatchObject({ isDuplicate: false, duplicateType: null, otherPaths: [] });
    });

    it('lists a copy that is also a result once, without the own path', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', copies: ['/b.jpg', '/c.jpg'] }),
        img('/b.jpg', { hash: 'h1', copies: ['/a.jpg', '/c.jpg'] }),
      ]);
      expect(out[0].otherPaths).toEqual(['/b.jpg', '/c.jpg']);
      expect(out[1].otherPaths).toEqual(['/a.jpg', '/c.jpg']);
    });

    it('gives both same-hash results the full group when only one carries copies', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1' }),
        img('/b.jpg', { hash: 'h1', copies: ['/a.jpg', '/c.jpg'] }),
      ]);
      expect(out[0]).toMatchObject({ duplicateType: 'exact', otherPaths: ['/b.jpg', '/c.jpg'] });
      expect(out[1]).toMatchObject({ duplicateType: 'exact', otherPaths: ['/a.jpg', '/c.jpg'] });
    });

    it('gives a result without copies the group brought by another result of its hash', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', copies: ['/c.jpg'] }),
        img('/x.jpg', { hash: 'h2' }),
        img('/b.jpg', { hash: 'h1' }),
      ]);
      expect(out[2]).toMatchObject({ duplicateType: 'exact', dupeColor: out[0].dupeColor, otherPaths: ['/a.jpg', '/c.jpg'] });
      expect(out[1]).toMatchObject({ isDuplicate: false, otherPaths: [] });
    });

    it('colors exact hashes in order of first appearance', () => {
      const out = annotateDuplicates([
        img('/x.jpg', { hash: 'h2', copies: ['/x2.jpg'] }),
        img('/a.jpg', { hash: 'h1', copies: ['/a2.jpg'] }),
      ]);
      expect(out[0].dupeColor).toBe('#0078d4');
      expect(out[1].dupeColor).toBe('#ec4899');
    });

    it('strips copies from the output and does not mutate the input', () => {
      const input = [img('/a.jpg', { hash: 'h1', copies: ['/b.jpg'] })];
      const out = annotateDuplicates(input);
      expect(out[0]).not.toHaveProperty('copies');
      expect(input[0].copies).toEqual(['/b.jpg']);
    });

    it('ignores copies of videos', () => {
      const out = annotateDuplicates([
        { path: '/v.mp4', media_type: 'video', hash: 'hv', copies: ['/v2.mp4'], score: 0.9 },
      ]);
      expect(out[0]).toMatchObject({ isDuplicate: false, duplicateType: null, otherPaths: [] });
      expect(out[0]).not.toHaveProperty('copies');
    });

    it('still builds visual groups, with exact winning over visual', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', visual_group: 0, copies: ['/a2.jpg'] }),
        img('/b.jpg', { hash: 'h2', visual_group: 0, copies: [] }),
        img('/c.jpg', { hash: 'h3', visual_group: 0, copies: [] }),
      ]);
      expect(out[0]).toMatchObject({ duplicateType: 'exact', otherPaths: ['/a2.jpg'] });
      expect(out[1]).toMatchObject({ duplicateType: 'visual', otherPaths: ['/a.jpg', '/c.jpg'] });
      expect(out[2]).toMatchObject({ duplicateType: 'visual', otherPaths: ['/a.jpg', '/b.jpg'] });
    });
  });

  it('gives different exact groups different colors', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { hash: 'h1' }),
      img('/b.jpg', { hash: 'h1' }),
      img('/c.jpg', { hash: 'h2' }),
      img('/d.jpg', { hash: 'h2' }),
    ]);
    expect(out[0].dupeColor).toBe('#0078d4');
    expect(out[2].dupeColor).toBe('#ec4899');
  });

  describe('visual groups from the backend', () => {
    it('tags the members of a visual_group as visual, with the other members as otherPaths', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', visual_group: 0 }),
        img('/b.jpg', { hash: 'h2', visual_group: 0 }),
        img('/c.jpg', { hash: 'h3', visual_group: 0 }),
      ]);
      expect(out[0]).toMatchObject({ duplicateType: 'visual', isDuplicate: true, otherPaths: ['/b.jpg', '/c.jpg'], dupeColor: '#f59e0b' });
      expect(out[1]).toMatchObject({ duplicateType: 'visual', isDuplicate: true, otherPaths: ['/a.jpg', '/c.jpg'], dupeColor: '#f59e0b' });
      expect(out[2]).toMatchObject({ duplicateType: 'visual', isDuplicate: true, otherPaths: ['/a.jpg', '/b.jpg'], dupeColor: '#f59e0b' });
    });

    it('does not tag results without a visual_group', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', visual_group: 0 }),
        img('/b.jpg', { hash: 'h2' }),
        img('/c.jpg', { hash: 'h3', visual_group: 0 }),
      ]);
      expect(out[1]).toMatchObject({ isDuplicate: false, duplicateType: null, dupeColor: null, otherPaths: [] });
      expect(out[0].otherPaths).toEqual(['/c.jpg']);
    });

    it('colors groups in order of their first member, whatever their numbers', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { visual_group: 7 }),
        img('/b.jpg', { visual_group: 2 }),
        img('/c.jpg', { visual_group: 7 }),
        img('/d.jpg', { visual_group: 2 }),
        img('/e.jpg', { visual_group: 4 }),
        img('/f.jpg', { visual_group: 4 }),
      ]);
      expect(out[0].dupeColor).toBe('#f59e0b');
      expect(out[2].dupeColor).toBe('#f59e0b');
      expect(out[1].dupeColor).toBe('#10b981');
      expect(out[3].dupeColor).toBe('#10b981');
      expect(out[4].dupeColor).toBe('#f97316');
      expect(out[5].dupeColor).toBe('#f97316');
      expect(out[0].otherPaths).toEqual(['/c.jpg']);
      expect(out[1].otherPaths).toEqual(['/d.jpg']);
      expect(out[5].otherPaths).toEqual(['/e.jpg']);
    });

    it('cycles the palette after four groups', () => {
      const input = Array.from({ length: 10 }, (_, i) => img(`/g${Math.floor(i / 2)}-${i % 2}.jpg`, { visual_group: Math.floor(i / 2) }));
      const out = annotateDuplicates(input);
      expect(out[8].dupeColor).toBe(out[0].dupeColor);
      expect(out[6].dupeColor).not.toBe(out[8].dupeColor);
    });

    it('ignores a group with a single member', () => {
      const out = annotateDuplicates([img('/a.jpg', { visual_group: 0 })]);
      expect(out[0]).toMatchObject({ isDuplicate: false, duplicateType: null, otherPaths: [] });
    });

    it('never tags videos, even with the same hash or a visual_group', () => {
      const video = (path) => ({ path, media_type: 'video', hash: 'hv', visual_group: 0, score: 0.9 });
      const out = annotateDuplicates([
        video('/v1.mp4'),
        video('/v2.mp4'),
        img('/a.jpg', { hash: 'hv' }),
      ]);
      out.forEach(item => {
        expect(item).toMatchObject({ isDuplicate: false, duplicateType: null, otherPaths: [] });
      });
    });

    it('prefers exact over visual when hashes match', () => {
      const out = annotateDuplicates([
        img('/a.jpg', { hash: 'h1', visual_group: 0 }),
        img('/b.jpg', { hash: 'h1', visual_group: 0 }),
        img('/c.jpg', { hash: 'h2', visual_group: 0 }),
      ]);
      expect(out[0].duplicateType).toBe('exact');
      expect(out[0].otherPaths).toEqual(['/b.jpg']);
      expect(out[1].duplicateType).toBe('exact');
      expect(out[2]).toMatchObject({ duplicateType: 'visual', otherPaths: ['/a.jpg', '/b.jpg'] });
    });
  });

  it('strips copies, embedding and visual_group and preserves other fields', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { embedding: [1, 0], copies: ['/z.jpg'], visual_group: 0, hash: 'h1', score: 0.77, custom: 'x', timestamp_seconds: 4 }),
      img('/b.jpg', { visual_group: 0 }),
      { path: '/v.mp4', media_type: 'video', embedding: [1, 0], visual_group: 0, copies: [], score: 0.1 },
    ]);
    out.forEach(item => {
      expect(item).not.toHaveProperty('embedding');
      expect(item).not.toHaveProperty('copies');
      expect(item).not.toHaveProperty('visual_group');
    });
    expect(out[0]).toMatchObject({ path: '/a.jpg', hash: 'h1', score: 0.77, custom: 'x', timestamp_seconds: 4 });
    expect(out[2]).toMatchObject({ path: '/v.mp4', media_type: 'video', score: 0.1 });
  });

  it('keeps the output order equal to the input order', () => {
    const paths = ['/c.jpg', '/a.jpg', '/b.jpg', '/d.jpg'];
    const input = paths.map(p => img(p, { hash: p === '/a.jpg' || p === '/d.jpg' ? 'same' : p }));
    expect(annotateDuplicates(input).map(r => r.path)).toEqual(paths);
  });

  it('does not mutate the input items', () => {
    const input = [img('/a.jpg', { visual_group: 0, copies: ['/b.jpg'] }), img('/c.jpg', { visual_group: 0 })];
    annotateDuplicates(input);
    expect(input[0]).toHaveProperty('visual_group', 0);
    expect(input[0]).toHaveProperty('copies');
    expect(input[0]).not.toHaveProperty('isDuplicate');
  });
});

describe('groupVideoResults', () => {
  const frame = (path, score, timestamp_seconds, extra = {}) => ({
    path, media_type: 'video', score, timestamp_seconds, ...extra,
  });

  it('ignores images and returns [] when there are no videos', () => {
    expect(groupVideoResults([])).toEqual([]);
    expect(groupVideoResults([img('/a.jpg')])).toEqual([]);
  });

  it('groups frames by path and takes the name from the basename', () => {
    const groups = groupVideoResults([
      frame('C:\\vids\\one.mp4', 0.5, 1),
      img('/a.jpg'),
      frame('/vids/two.mp4', 0.4, 2),
      frame('C:\\vids\\one.mp4', 0.6, 9),
    ]);
    expect(groups).toHaveLength(2);
    const one = groups.find(g => g.path === 'C:\\vids\\one.mp4');
    expect(one.name).toBe('one.mp4');
    expect(one.frames).toHaveLength(2);
    expect(groups.find(g => g.path === '/vids/two.mp4').name).toBe('two.mp4');
  });

  it('falls back to the full path when the basename is empty', () => {
    const groups = groupVideoResults([frame('/vids/', 0.5, 1)]);
    expect(groups[0].name).toBe('/vids/');
  });

  it('tracks the best frame and best score', () => {
    const low = frame('/v.mp4', 0.3, 1);
    const high = frame('/v.mp4', 0.8, 5);
    const mid = frame('/v.mp4', 0.5, 9);
    const [group] = groupVideoResults([low, high, mid]);
    expect(group.bestScore).toBe(0.8);
    expect(group.bestFrame).toBe(high);
  });

  it('keeps the first frame as best on ties and treats a missing score as 0', () => {
    const first = frame('/v.mp4', 0.5, 1);
    const second = frame('/v.mp4', 0.5, 2);
    const noScore = { path: '/w.mp4', media_type: 'video' };
    const groups = groupVideoResults([first, second, noScore]);
    expect(groups[0].bestFrame).toBe(first);
    expect(groups.find(g => g.path === '/w.mp4').bestScore).toBe(0);
  });

  it('keeps the order of first appearance and the time order of frames when nothing has a score', () => {
    const browse = (path, timestamp_seconds) => ({
      path, media_type: 'video', score: null, score_kind: 'none', timestamp_seconds, taken_at: '2024-03-12T10:00:00',
    });
    const results = [
      browse('/z-newest.mp4', 0),
      browse('/z-newest.mp4', 4),
      browse('/a-middle.mp4', 2),
      browse('/m-oldest.mp4', 1),
      browse('/m-oldest.mp4', 9),
      browse('/a-middle.mp4', 8),
    ];
    const groups = groupVideoResults(results);
    expect(groups.map(g => g.path)).toEqual(['/z-newest.mp4', '/a-middle.mp4', '/m-oldest.mp4']);
    expect(groups.map(g => g.frames.map(f => f.timestamp_seconds))).toEqual([[0, 4], [2, 8], [1, 9]]);
    // Without scores the first frame stands for the video.
    expect(groups[0].bestFrame).toBe(results[0]);
    expect(groups[0].bestScore).toBe(0);
  });

  it('sorts frames by score desc, then timestamp asc', () => {
    const [group] = groupVideoResults([
      frame('/v.mp4', 0.5, 30),
      frame('/v.mp4', 0.9, 50),
      frame('/v.mp4', 0.5, 10),
      frame('/v.mp4', 0.5, 20),
    ]);
    expect(group.frames.map(f => [f.score, f.timestamp_seconds])).toEqual([
      [0.9, 50], [0.5, 10], [0.5, 20], [0.5, 30],
    ]);
  });

  it('sorts groups by best score desc', () => {
    const groups = groupVideoResults([
      frame('/a.mp4', 0.3, 1),
      frame('/b.mp4', 0.9, 1),
      frame('/c.mp4', 0.6, 1),
      frame('/a.mp4', 0.4, 2),
    ]);
    expect(groups.map(g => g.path)).toEqual(['/b.mp4', '/c.mp4', '/a.mp4']);
  });

  it('does not mutate the input array', () => {
    const input = [frame('/v.mp4', 0.1, 5), frame('/v.mp4', 0.9, 1), img('/a.jpg')];
    const snapshot = [...input];
    groupVideoResults(input);
    expect(input).toHaveLength(3);
    input.forEach((item, i) => expect(item).toBe(snapshot[i]));
  });

  it('reports no expansion by default', () => {
    const [group] = groupVideoResults([frame('/v.mp4', 0.5, 1)]);
    expect(group).toMatchObject({ totalFrames: null, isExpanded: false });
  });

  describe('with expanded frames', () => {
    it('merges the expansion into the group, sorted, with totalFrames and isExpanded', () => {
      const shown = frame('/v.mp4', 0.6, 30, { id: 'a' });
      const [group] = groupVideoResults([shown], {
        '/v.mp4': {
          frames: [frame('/v.mp4', 0.5, 10, { id: 'b' }), frame('/v.mp4', 0.5, 5, { id: 'c' }), frame('/v.mp4', 0.3, 1, { id: 'd' })],
          totalFrames: 700,
        },
      });
      expect(group.frames.map(f => f.id)).toEqual(['a', 'c', 'b', 'd']);
      expect(group).toMatchObject({ totalFrames: 700, isExpanded: true, bestScore: 0.6 });
      expect(group.bestFrame).toBe(shown);
    });

    it('dedupes frames by id, keeping the one from the search results', () => {
      const shown = frame('/v.mp4', 0.6, 30, { id: 'a' });
      const [group] = groupVideoResults([shown], {
        '/v.mp4': { frames: [frame('/v.mp4', 0.6, 30, { id: 'a' }), frame('/v.mp4', 0.4, 2, { id: 'b' })], totalFrames: 2 },
      });
      expect(group.frames).toHaveLength(2);
      expect(group.frames.find(f => f.id === 'a')).toBe(shown);
    });

    it('dedupes by path and timestamp when frames have no id', () => {
      const [group] = groupVideoResults([frame('/v.mp4', 0.6, 30)], {
        '/v.mp4': { frames: [frame('/v.mp4', 0.6, 30), frame('/v.mp4', 0.4, 31)], totalFrames: 2 },
      });
      expect(group.frames.map(f => f.timestamp_seconds)).toEqual([30, 31]);
    });

    it('takes the best frame and score over the merged frames', () => {
      const better = frame('/v.mp4', 0.95, 9, { id: 'z' });
      const [group] = groupVideoResults([frame('/v.mp4', 0.6, 30, { id: 'a' })], {
        '/v.mp4': { frames: [better], totalFrames: 2 },
      });
      expect(group.bestScore).toBe(0.95);
      expect(group.bestFrame).toBe(better);
      expect(group.frames[0]).toBe(better);
    });

    it('does not reorder the groups when an expansion has a better frame', () => {
      const results = [frame('/a.mp4', 0.9, 1, { id: 'a1' }), frame('/b.mp4', 0.5, 1, { id: 'b1' })];
      const before = groupVideoResults(results).map(g => g.path);
      const after = groupVideoResults(results, {
        '/b.mp4': { frames: [frame('/b.mp4', 0.99, 7, { id: 'b2' })], totalFrames: 2 },
      });
      expect(before).toEqual(['/a.mp4', '/b.mp4']);
      expect(after.map(g => g.path)).toEqual(before);
      expect(after[1].bestScore).toBe(0.99);
      expect(after[1]).not.toHaveProperty('searchBestScore');
    });

    it('ignores a path that has no group in the results', () => {
      const groups = groupVideoResults([frame('/a.mp4', 0.9, 1)], {
        '/other.mp4': { frames: [frame('/other.mp4', 0.8, 1)], totalFrames: 1 },
      });
      expect(groups.map(g => g.path)).toEqual(['/a.mp4']);
      expect(groups[0].isExpanded).toBe(false);
    });

    it('leaves other groups unexpanded and does not mutate the input', () => {
      const results = [frame('/a.mp4', 0.9, 1, { id: 'a1' }), frame('/b.mp4', 0.5, 1, { id: 'b1' })];
      const expansion = { '/a.mp4': { frames: [frame('/a.mp4', 0.4, 5, { id: 'a2' })], totalFrames: 2 } };
      const groups = groupVideoResults(results, expansion);
      expect(groups[0].isExpanded).toBe(true);
      expect(groups[1]).toMatchObject({ isExpanded: false, totalFrames: null });
      expect(results).toHaveLength(2);
      expect(expansion['/a.mp4'].frames).toHaveLength(1);
    });
  });
});

describe('countSearchResults', () => {
  it('counts every image and each video once', () => {
    const frame = (path, ts) => ({ path, media_type: 'video', timestamp_seconds: ts });
    expect(countSearchResults([
      img('/a.jpg'), frame('/v.mp4', 1), frame('/v.mp4', 2), frame('/w.mp4', 1), img('/b.jpg'),
    ])).toBe(4);
    expect(countSearchResults([])).toBe(0);
    expect(countSearchResults(null)).toBe(0);
  });
});

describe('getImageResults', () => {
  it('filters out videos', () => {
    const a = img('/a.jpg');
    const v = { path: '/v.mp4', media_type: 'video' };
    const noType = { path: '/x.jpg' };
    expect(getImageResults([a, v, noType])).toEqual([a, noType]);
    expect(getImageResults([])).toEqual([]);
  });
});
