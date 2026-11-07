import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActiveFilterChips } from './ActiveFilterChips';

const makeChips = (labels) => labels.map(label => ({ key: label, label, onRemove: vi.fn() }));

describe('ActiveFilterChips', () => {
  afterEach(cleanup);

  it('renders nothing without chips', () => {
    const { container } = render(<ActiveFilterChips chips={[]} onClearAll={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one pill per chip', () => {
    render(<ActiveFilterChips chips={makeChips(['Images only', '2024'])} onClearAll={vi.fn()} />);
    expect(screen.getByText('Images only')).toBeTruthy();
    expect(screen.getByText('2024')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Active filters' })).toBeTruthy();
  });

  it('removes a single filter through its x button', () => {
    const chips = makeChips(['Images only', '2024']);
    render(<ActiveFilterChips chips={chips} onClearAll={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: 2024' }));
    expect(chips[1].onRemove).toHaveBeenCalledTimes(1);
    expect(chips[0].onRemove).not.toHaveBeenCalled();
  });

  it('offers Clear all only with two or more chips', () => {
    const onClearAll = vi.fn();
    const { rerender } = render(<ActiveFilterChips chips={makeChips(['Images only'])} onClearAll={onClearAll} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();

    rerender(<ActiveFilterChips chips={makeChips(['Images only', '2024'])} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
