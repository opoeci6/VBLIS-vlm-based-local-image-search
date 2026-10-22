import { describe, expect, it } from 'vitest';
import { ASCII_GLYPHS, VBLIS_ASCII_POINTS, buildAsciiLogoPoints } from './asciiLogoPoints';

describe('asciiLogoPoints', () => {
  const filledCells = 'VBLIS'
    .split('')
    .reduce((total, letter) => total + ASCII_GLYPHS[letter].join('').split('1').length - 1, 0);

  it('has 7 rows of 5 cells for each letter', () => {
    for (const letter of 'VBLIS') {
      expect(ASCII_GLYPHS[letter]).toHaveLength(7);
      ASCII_GLYPHS[letter].forEach(row => expect(row).toMatch(/^[01]{5}$/));
    }
  });

  it('emits 78 points per filled cell (9x2 face points + 5x3x4 edge points)', () => {
    expect(filledCells).toBeGreaterThan(0);
    expect(VBLIS_ASCII_POINTS.length).toBe(filledCells * (9 * 2 + 5 * 3 * 4));
    expect(VBLIS_ASCII_POINTS.length).toBe(filledCells * 78);
  });

  it('is deterministic', () => {
    expect(buildAsciiLogoPoints()).toEqual(VBLIS_ASCII_POINTS);
  });

  it('keeps every z within +/-1.35', () => {
    for (const point of VBLIS_ASCII_POINTS) {
      expect(Math.abs(point.z)).toBeLessThanOrEqual(1.35);
    }
  });
});
