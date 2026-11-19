import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resetEscapeKeyForTests } from '../../hooks/useEscapeKey';
import { SessionThemeControl } from './SessionThemeControl';

describe('SessionThemeControl', () => {
  afterEach(() => {
    cleanup();
    resetEscapeKeyForTests();
  });

  it('switches light and dark', () => {
    const setTheme = vi.fn();
    const { rerender } = render(<SessionThemeControl theme="light" setTheme={setTheme} uiTheme="modern" setUiTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
    rerender(<SessionThemeControl theme="dark" setTheme={setTheme} uiTheme="modern" setUiTheme={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Light Mode' }));
    expect(setTheme).toHaveBeenLastCalledWith('light');
  });

  it('opens the style options, chooses one and closes them', () => {
    const setUiTheme = vi.fn();
    render(<SessionThemeControl theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={setUiTheme} />);
    expect(screen.queryByText('UI Theme Style')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch UI Theme Style' }));
    expect(screen.getByText('UI Theme Style')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retro Terminal/ }));
    expect(setUiTheme).toHaveBeenCalledWith('terminal');
    expect(screen.queryByText('UI Theme Style')).toBeNull();
  });

  it('closes the style options on Esc and on a press outside', () => {
    render(
      <div>
        <p data-testid="outside">outside</p>
        <SessionThemeControl theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch UI Theme Style' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('UI Theme Style')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Switch UI Theme Style' }));
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('UI Theme Style')).toBeNull();
  });

  it('floats at the top right below the notch, and is not a full bar', () => {
    const { container } = render(<SessionThemeControl theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={vi.fn()} />);
    const root = container.firstChild;
    expect(root.className).toContain('fixed');
    expect(root.className).toContain('right-0');
    expect(root.className).toContain('pt-safe');
    expect(root.className).not.toContain('w-full');
  });
});
