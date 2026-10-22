import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from './Toast';

describe('Toast', () => {
  afterEach(cleanup);

  it('renders the message', () => {
    render(<Toast toast={{ message: 'Saved!', type: 'success' }} onClose={() => {}} />);
    expect(screen.getByText('Saved!')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Toast toast={{ message: 'Oops', type: 'error' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the success and error styles', () => {
    const { container, rerender } = render(<Toast toast={{ message: 'x', type: 'success' }} onClose={() => {}} />);
    expect(container.firstChild.className).toContain('bg-emerald-50');
    rerender(<Toast toast={{ message: 'x', type: 'error' }} onClose={() => {}} />);
    expect(container.firstChild.className).toContain('bg-rose-50');
  });
});
