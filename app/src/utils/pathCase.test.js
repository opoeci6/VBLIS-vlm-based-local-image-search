import { afterEach, describe, expect, it } from 'vitest';
import { foldPath, setCaseSensitivePaths } from './pathCase';

describe('pathCase', () => {
  afterEach(() => setCaseSensitivePaths(false));

  it('folds case by default', () => {
    expect(foldPath('C:\\Photos\\Trips')).toBe('c:\\photos\\trips');
  });

  it('keeps case once paths are case-sensitive', () => {
    setCaseSensitivePaths(true);
    expect(foldPath('/Photos/Trips')).toBe('/Photos/Trips');
  });

  it('goes back to folding when switched off again', () => {
    setCaseSensitivePaths(true);
    setCaseSensitivePaths(false);
    expect(foldPath('/Photos')).toBe('/photos');
  });
});
