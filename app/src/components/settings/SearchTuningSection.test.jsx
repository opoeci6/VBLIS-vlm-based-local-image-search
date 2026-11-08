import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchTuningSection } from './SearchTuningSection';

const renderSection = (overrides = {}) => {
  const props = { minScore: 0.2, setMinScore: vi.fn(), minSimilarity: 0.7, setMinSimilarity: vi.fn(), maxResults: 50, setMaxResults: vi.fn(), resetSearchTuning: vi.fn(), ...overrides };
  const utils = render(<SearchTuningSection {...props} />);
  return { props, sliders: utils.container.querySelectorAll('input[type="range"]'), ...utils };
};

describe('SearchTuningSection', () => {
  afterEach(cleanup);

  it('shows the minimum match score, minimum similarity and the result limit', () => {
    renderSection({ minScore: 0.35, minSimilarity: 0.72, maxResults: 120 });
    expect(screen.getByText('Minimum Match Score')).toBeTruthy();
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('Minimum Similarity')).toBeTruthy();
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('Maximum Display Results')).toBeTruthy();
    expect(screen.getByText('120 Results')).toBeTruthy();
    expect(screen.getByText(/Each video counts as one result/)).toBeTruthy();
    expect(screen.getByText(/Higher numbers may consume more system memory/)).toBeTruthy();
    expect(screen.queryByText(/Warning: Unlimited/)).toBeNull();
  });

  it('parses slider values into numbers', () => {
    const { props, sliders } = renderSection();
    expect(sliders).toHaveLength(3);

    fireEvent.change(sliders[0], { target: { value: '0.4' } });
    expect(props.setMinScore).toHaveBeenCalledWith(0.4);

    fireEvent.change(sliders[1], { target: { value: '0.85' } });
    expect(props.setMinSimilarity).toHaveBeenCalledWith(0.85);
    expect(props.setMinScore).toHaveBeenCalledTimes(1);

    fireEvent.change(sliders[2], { target: { value: '100' } });
    expect(props.setMaxResults).toHaveBeenCalledWith(100);
  });

  it('uses the documented slider ranges', () => {
    const { sliders } = renderSection();
    expect([sliders[0].min, sliders[0].max, sliders[0].step]).toEqual(['0.01', '0.95', '0.01']);
    expect([sliders[1].min, sliders[1].max, sliders[1].step]).toEqual(['0.30', '0.95', '0.01']);
  });

  it('shows "Unlimited" and a warning at 0', () => {
    renderSection({ maxResults: 0 });
    expect(screen.getByText('Unlimited')).toBeTruthy();
    expect(screen.getByText('Warning: Unlimited results may impact performance and memory.')).toBeTruthy();
  });

  it('treats a string zero as unlimited too', () => {
    renderSection({ maxResults: '0' });
    expect(screen.getByText('Unlimited')).toBeTruthy();
  });

  describe('Reset to defaults', () => {
    it('is disabled while all three values are the defaults', () => {
      renderSection({ minScore: 0.1, minSimilarity: 0.7, maxResults: 50 });
      expect(screen.getByRole('button', { name: 'Reset to defaults' }).disabled).toBe(true);
    });

    it.each([
      ['minScore', { minScore: 0.2 }],
      ['minSimilarity', { minSimilarity: 0.8 }],
      ['maxResults', { maxResults: 0 }],
    ])('is enabled when %s differs and calls the handler', (_name, overrides) => {
      const { props } = renderSection({ minScore: 0.1, minSimilarity: 0.7, maxResults: 50, ...overrides });
      const button = screen.getByRole('button', { name: 'Reset to defaults' });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(props.resetSearchTuning).toHaveBeenCalledTimes(1);
    });
  });
});
