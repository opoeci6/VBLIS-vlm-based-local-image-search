import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchTuningSection } from './SearchTuningSection';

const renderSection = (overrides = {}) => {
  const props = { minScore: 0.2, setMinScore: vi.fn(), maxResults: 50, setMaxResults: vi.fn(), ...overrides };
  const utils = render(<SearchTuningSection {...props} />);
  return { props, sliders: utils.container.querySelectorAll('input[type="range"]'), ...utils };
};

describe('SearchTuningSection', () => {
  afterEach(cleanup);

  it('shows the minimum score as a percentage and the result limit', () => {
    renderSection({ minScore: 0.35, maxResults: 120 });
    expect(screen.getByText('Minimum Match Score')).toBeTruthy();
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('Maximum Display Results')).toBeTruthy();
    expect(screen.getByText('120 Images')).toBeTruthy();
    expect(screen.queryByText(/Warning: Unlimited/)).toBeNull();
  });

  it('parses slider values into numbers', () => {
    const { props, sliders } = renderSection();
    expect(sliders).toHaveLength(2);

    fireEvent.change(sliders[0], { target: { value: '0.4' } });
    expect(props.setMinScore).toHaveBeenCalledWith(0.4);

    fireEvent.change(sliders[1], { target: { value: '100' } });
    expect(props.setMaxResults).toHaveBeenCalledWith(100);
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
});
