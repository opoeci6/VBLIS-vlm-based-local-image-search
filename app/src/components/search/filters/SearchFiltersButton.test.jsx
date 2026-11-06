import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchFiltersButton } from './SearchFiltersButton';

describe('SearchFiltersButton', () => {
  afterEach(cleanup);

  it('shows no count badge without active filters', () => {
    render(<SearchFiltersButton activeCount={0} isOpen={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Search filters' });
    expect(button.textContent).toBe('Filters');
    expect(screen.queryByTestId('filters-count')).toBeNull();
  });

  it('shows the number of active filters', () => {
    render(<SearchFiltersButton activeCount={3} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Search filters (3 active)' })).toBeTruthy();
    expect(screen.getByTestId('filters-count').textContent).toBe('3');
  });

  it('exposes the open state and the dialog it controls', () => {
    const { rerender } = render(<SearchFiltersButton activeCount={0} isOpen={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Search filters' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    rerender(<SearchFiltersButton activeCount={0} isOpen onToggle={vi.fn()} />);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('is a plain button: it toggles without submitting a form', () => {
    const onToggle = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SearchFiltersButton activeCount={0} isOpen={false} onToggle={onToggle} />
      </form>
    );
    const button = screen.getByRole('button', { name: 'Search filters' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is marked so the panel does not count a click on it as outside', () => {
    render(<SearchFiltersButton activeCount={0} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Search filters' }).hasAttribute('data-filters-toggle')).toBe(true);
  });
});
