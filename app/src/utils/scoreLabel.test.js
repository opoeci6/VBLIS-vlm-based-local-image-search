import { describe, it, expect } from 'vitest';
import {
  formatScorePercent,
  scoreWord,
  isSimilarityKind,
  formatScoreLabel,
  formatScoreLabelUpper
} from './scoreLabel';

describe('formatScorePercent', () => {
  it('floors below 99% instead of rounding', () => {
    expect(formatScorePercent(0.974)).toBe('97%');
    expect(formatScorePercent(0.979)).toBe('97%');
    expect(formatScorePercent(0.985)).toBe('98%');
    expect(formatScorePercent(0.989999)).toBe('98%');
    expect(formatScorePercent(0.1)).toBe('10%');
    expect(formatScorePercent(0)).toBe('0%');
  });

  it('is not thrown off by floating point error', () => {
    expect(formatScorePercent(0.57)).toBe('57%');
    expect(formatScorePercent(0.29)).toBe('29%');
    expect(formatScorePercent(0.58)).toBe('58%');
  });

  it('uses one floored decimal from 99% up', () => {
    expect(formatScorePercent(0.9987)).toBe('99.8%');
    expect(formatScorePercent(0.995)).toBe('99.5%');
    expect(formatScorePercent(0.998)).toBe('99.8%');
    // Documented choice: exactly 0.99 keeps the decimal.
    expect(formatScorePercent(0.99)).toBe('99.0%');
  });

  it('never shows 100% unless the score is exactly 1', () => {
    expect(formatScorePercent(0.9999)).toBe('99.9%');
    expect(formatScorePercent(0.9999999999)).toBe('99.9%');
    expect(formatScorePercent(1)).toBe('100%');
  });

  it('clamps out-of-range scores', () => {
    expect(formatScorePercent(1.2)).toBe('100%');
    expect(formatScorePercent(-0.3)).toBe('0%');
  });

  it('treats non-numeric input as 0%', () => {
    expect(formatScorePercent(undefined)).toBe('0%');
    expect(formatScorePercent(null)).toBe('0%');
    expect(formatScorePercent('abc')).toBe('0%');
    expect(formatScorePercent(NaN)).toBe('0%');
  });
});

describe('scoreWord', () => {
  it('maps kinds to words, defaulting to match', () => {
    expect(scoreWord('match')).toBe('match');
    expect(scoreWord('similarity')).toBe('similar');
    expect(scoreWord(undefined)).toBe('match');
    expect(scoreWord('something-else')).toBe('match');
  });

  it('detects the similarity kind', () => {
    expect(isSimilarityKind('similarity')).toBe(true);
    expect(isSimilarityKind('match')).toBe(false);
    expect(isSimilarityKind(undefined)).toBe(false);
  });
});

describe('score labels', () => {
  it('formats title case labels', () => {
    expect(formatScoreLabel(0.976, 'match')).toBe('97% Match');
    expect(formatScoreLabel(0.84, 'similarity')).toBe('84% Similar');
    expect(formatScoreLabel(0.5)).toBe('50% Match');
  });

  it('formats uppercase labels', () => {
    expect(formatScoreLabelUpper(0.976, 'match')).toBe('97% MATCH');
    expect(formatScoreLabelUpper(0.84, 'similarity')).toBe('84% SIMILAR');
    expect(formatScoreLabelUpper(undefined)).toBe('0% MATCH');
  });
});
