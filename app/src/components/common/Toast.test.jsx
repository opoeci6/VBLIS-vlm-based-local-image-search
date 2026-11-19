import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
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

  it('names its close button, and gives it a 40 px target on a phone', () => {
    render(<Toast toast={{ message: 'Oops', type: 'error' }} onClose={() => {}} />);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('h-10');
    expect(close.className).toContain('w-10');
  });

  it('fits a phone: the width of the screen less 2rem above the home bar, from sm up its own width', () => {
    const { container } = render(<Toast toast={{ message: 'Saved!', type: 'success' }} onClose={() => {}} />);
    const classes = container.firstChild.className;
    expect(classes).toContain('w-[calc(100%-2rem)]');
    expect(classes).toContain('bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]');
    expect(classes).toContain('sm:bottom-8');
    expect(classes).toContain('sm:w-auto');
    // No 320 px minimum on a phone: it would overflow a 320 px screen.
    expect(classes).not.toMatch(/(^|\s)min-w-\[320px\]/);
    expect(classes).toContain('sm:min-w-[320px]');
  });

  it('names its close button in Chinese too', async () => {
    await i18n.changeLanguage('zh-CN');
    render(<Toast toast={{ message: 'x', type: 'info' }} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
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
