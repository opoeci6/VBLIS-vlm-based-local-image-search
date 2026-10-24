import { describe, expect, it } from 'vitest';
import { annotateDuplicates, getImageResults, groupVideoResults } from './searchResults';

// Unit vectors: dot(a, b) is the cosine similarity.
const unit = (cos) => [cos, Math.sqrt(1 - cos * cos)];
const BASE = [1, 0];

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

  it('tags near-identical embeddings with different hashes as visual', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { hash: 'h1', embedding: BASE }),
      img('/b.jpg', { hash: 'h2', embedding: unit(0.99) }),
    ]);
    expect(out[0]).toMatchObject({ duplicateType: 'visual', isDuplicate: true, otherPaths: ['/b.jpg'], dupeColor: '#f59e0b' });
    expect(out[1]).toMatchObject({ duplicateType: 'visual', isDuplicate: true, otherPaths: ['/a.jpg'], dupeColor: '#f59e0b' });
  });

  it('treats the 0.985 boundary as visual and 0.98 as not', () => {
    const at = annotateDuplicates([
      img('/a.jpg', { embedding: [1, 0] }),
      img('/b.jpg', { embedding: [0.985, 0] }),
    ]);
    expect(at[0].duplicateType).toBe('visual');

    const below = annotateDuplicates([
      img('/a.jpg', { embedding: BASE }),
      img('/b.jpg', { embedding: unit(0.98) }),
    ]);
    expect(below[0].duplicateType).toBeNull();
    expect(below[1].duplicateType).toBeNull();
  });

  it('merges visual groups transitively when a later pair bridges two groups', () => {
    const at = (deg) => {
      const t = (deg * Math.PI) / 180;
      return [Math.cos(t), Math.sin(t)];
    };
    // Pairs 9 degrees apart are similar (cos ~0.9877); 18 and 27 degrees apart are not.
    // Pair loop order: {0,3}, then {1,2}, then the bridge (2,3).
    const out = annotateDuplicates([
      img('/a.jpg', { hash: 'h0', embedding: at(0) }),
      img('/b.jpg', { hash: 'h1', embedding: at(27) }),
      img('/c.jpg', { hash: 'h2', embedding: at(18) }),
      img('/d.jpg', { hash: 'h3', embedding: at(9) }),
    ]);
    out.forEach(item => expect(item.duplicateType).toBe('visual'));
    expect(new Set(out.map(item => item.dupeColor)).size).toBe(1);
    const all = ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'];
    out.forEach(item => {
      expect([...item.otherPaths].sort()).toEqual(all.filter(p => p !== item.path));
    });
  });

  it('orders visual groups by smallest member index for color assignment', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { embedding: [1, 0] }),
      img('/b.jpg', { embedding: [0, 1] }),
      img('/c.jpg', { embedding: [1, 0] }),
      img('/d.jpg', { embedding: [0, 1] }),
    ]);
    expect(out[0].dupeColor).toBe('#f59e0b');
    expect(out[2].dupeColor).toBe('#f59e0b');
    expect(out[1].dupeColor).toBe('#10b981');
    expect(out[3].dupeColor).toBe('#10b981');
  });

  it('never tags videos, even with the same hash or embedding', () => {
    const video = (path) => ({ path, media_type: 'video', hash: 'hv', embedding: BASE, score: 0.9 });
    const out = annotateDuplicates([
      video('/v1.mp4'),
      video('/v2.mp4'),
      img('/a.jpg', { hash: 'hv', embedding: BASE }),
    ]);
    out.forEach(item => {
      expect(item).toMatchObject({ isDuplicate: false, duplicateType: null, otherPaths: [] });
    });
  });

  it('prefers exact over visual when hashes match', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { hash: 'h1', embedding: BASE }),
      img('/b.jpg', { hash: 'h1', embedding: BASE }),
    ]);
    expect(out[0].duplicateType).toBe('exact');
    expect(out[1].duplicateType).toBe('exact');
  });

  it('strips embeddings and preserves other fields', () => {
    const out = annotateDuplicates([
      img('/a.jpg', { embedding: BASE, hash: 'h1', score: 0.77, custom: 'x', timestamp_seconds: 4 }),
      { path: '/v.mp4', media_type: 'video', embedding: BASE, score: 0.1 },
    ]);
    out.forEach(item => expect(item).not.toHaveProperty('embedding'));
    expect(out[0]).toMatchObject({ path: '/a.jpg', hash: 'h1', score: 0.77, custom: 'x', timestamp_seconds: 4 });
    expect(out[1]).toMatchObject({ path: '/v.mp4', media_type: 'video', score: 0.1 });
  });

  it('keeps the output order equal to the input order', () => {
    const paths = ['/c.jpg', '/a.jpg', '/b.jpg', '/d.jpg'];
    const input = paths.map(p => img(p, { hash: p === '/a.jpg' || p === '/d.jpg' ? 'same' : p }));
    expect(annotateDuplicates(input).map(r => r.path)).toEqual(paths);
  });

  it('does not mutate the input items', () => {
    const input = [img('/a.jpg', { embedding: BASE })];
    annotateDuplicates(input);
    expect(input[0]).toHaveProperty('embedding');
    expect(input[0]).not.toHaveProperty('isDuplicate');
  });

  describe('800-candidate cap', () => {
    const filler = (n) => Array.from({ length: n }, (_, i) => img(`/f${i}.jpg`, { embedding: [0, 1] }));

    it('tags a near-duplicate pair at indices 0 and 1', () => {
      const input = [
        img('/a.jpg', { embedding: BASE }),
        img('/b.jpg', { embedding: unit(0.99) }),
        ...filler(10),
      ];
      const out = annotateDuplicates(input);
      expect(out[0].duplicateType).toBe('visual');
      expect(out[1].duplicateType).toBe('visual');
    });

    it('does not tag the same pair at indices 800 and 801', () => {
      const input = [
        ...filler(800),
        img('/a.jpg', { embedding: BASE }),
        img('/b.jpg', { embedding: unit(0.99) }),
      ];
      const out = annotateDuplicates(input);
      expect(out).toHaveLength(802);
      expect(out[800].duplicateType).toBeNull();
      expect(out[801].duplicateType).toBeNull();
    });
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
