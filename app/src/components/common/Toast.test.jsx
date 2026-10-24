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

  it('uses the indigo info style and Info icon for info toasts', () => {
    const { container } = render(<Toast toast={{ message: 'FYI', type: 'info' }} onClose={() => {}} />);
    const root = container.firstChild;
    expect(root.className).toContain('bg-indigo-50');
    expect(root.className).toContain('border-indigo-200');
    expect(root.className).toContain('text-indigo-800');
    expect(root.className).not.toContain('rose');
    expect(root.className).not.toContain('emerald');
    const icon = root.querySelector('svg');
    expect(icon.getAttribute('class')).toContain('lucide-info');
    expect(icon.getAttribute('class')).toContain('text-indigo-400');
    expect(screen.getByRole('button').className).toContain('text-indigo-400');
  });

  it('uses the emerald success style and check icon', () => {
    const { container } = render(<Toast toast={{ message: 'ok', type: 'success' }} onClose={() => {}} />);
    const root = container.firstChild;
    expect(root.className).toContain('border-emerald-200');
    expect(root.className).not.toContain('indigo');
    const icon = root.querySelector('svg');
    expect(icon.getAttribute('class')).toContain('lucide-circle-check');
    expect(icon.getAttribute('class')).toContain('text-emerald-400');
    expect(screen.getByRole('button').className).toContain('text-emerald-400');
  });

  it('uses the rose error style and warning icon for error and unknown types', () => {
    const { container, rerender } = render(<Toast toast={{ message: 'bad', type: 'error' }} onClose={() => {}} />);
    for (const type of ['error', 'whatever']) {
      rerender(<Toast toast={{ message: 'bad', type }} onClose={() => {}} />);
      const root = container.firstChild;
      expect(root.className).toContain('border-rose-200');
      expect(root.className).not.toContain('indigo');
      const icon = root.querySelector('svg');
      expect(icon.getAttribute('class')).toContain('lucide-triangle-alert');
      expect(icon.getAttribute('class')).toContain('text-rose-400');
      expect(screen.getByRole('button').className).toContain('text-rose-400');
    }
  });

  it('calls onClose from the close button on info toasts', () => {
    const onClose = vi.fn();
    render(<Toast toast={{ message: 'FYI', type: 'info' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
