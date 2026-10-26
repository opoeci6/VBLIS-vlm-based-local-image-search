// Shared formatting for search result scores.
//
// score_kind is "match" (text search on SigLIP: calibrated match score) or "similarity"
// (image search, and text search on CLIP: cosine similarity). A missing kind means "match".

const clampScore = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

// Tiny nudge so values like 0.57 (0.57 * 100 = 56.99999999999999) floor to the expected digit.
const EPSILON = 1e-9;

// Percent text that never rounds up: 0.9987 -> "99.8%", 0.9999 -> "99.9%", only exactly 1 -> "100%".
// Below 0.99 whole percents are used (floored); from 0.99 up, one floored decimal ("99.0%").
export const formatScorePercent = (score) => {
  const value = clampScore(score);
  if (value >= 1) return '100%';
  if (value < 0.99) return `${Math.floor(value * 100 + EPSILON)}%`;
  const tenths = Math.min(999, Math.floor(value * 1000 + EPSILON));
  return `${(tenths / 10).toFixed(1)}%`;
};

export const isSimilarityKind = (kind) => kind === 'similarity';

// "match" for "match"/missing, "similar" for "similarity".
export const scoreWord = (kind) => (isSimilarityKind(kind) ? 'similar' : 'match');

// "97% Match" / "84% Similar"
export const formatScoreLabel = (score, kind) => {
  const word = scoreWord(kind);
  return `${formatScorePercent(score)} ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
};

// "97% MATCH" / "84% SIMILAR"
export const formatScoreLabelUpper = (score, kind) => `${formatScorePercent(score)} ${scoreWord(kind).toUpperCase()}`;
