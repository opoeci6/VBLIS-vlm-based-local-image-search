import { describe, expect, it } from 'vitest';
import { cardAnimationDelay } from './cardAnimation';

describe('cardAnimationDelay', () => {
  it('caps the fade-in delay at 600ms (12 steps of 50ms)', () => {
    expect(cardAnimationDelay(0)).toBe('0ms');
    expect(cardAnimationDelay(5)).toBe('250ms');
    expect(cardAnimationDelay(12)).toBe('600ms');
    expect(cardAnimationDelay(500)).toBe('600ms');
  });
});
