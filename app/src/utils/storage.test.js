import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJson, writeJson } from './storage';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a value', () => {
    writeJson('k', { a: 1, b: [2, 3] });
    expect(readJson('k', null)).toEqual({ a: 1, b: [2, 3] });
  });

  it('returns the fallback for a missing key', () => {
    expect(readJson('missing', 'fallback')).toBe('fallback');
  });

  it('returns the fallback for bad JSON', () => {
    localStorage.setItem('k', '{not json');
    expect(readJson('k', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readJson('k', 'fallback')).toBe('fallback');
  });

  it('does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => writeJson('k', { a: 1 })).not.toThrow();
  });
});
