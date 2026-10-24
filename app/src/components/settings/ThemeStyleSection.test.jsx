import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeStyleSection } from './ThemeStyleSection';

describe('ThemeStyleSection', () => {
  afterEach(cleanup);

  it('selects the terminal theme', () => {
    const setUiTheme = vi.fn();
    render(<ThemeStyleSection uiTheme="modern" setUiTheme={setUiTheme} />);
    expect(screen.getByText('UI Theme Style')).toBeTruthy();
    fireEvent.click(screen.getByText('Retro Terminal'));
    expect(setUiTheme).toHaveBeenCalledWith('terminal');
  });

  it('selects the modern theme', () => {
    const setUiTheme = vi.fn();
    render(<ThemeStyleSection uiTheme="terminal" setUiTheme={setUiTheme} />);
    fireEvent.click(screen.getByText('Modern Rounded'));
    expect(setUiTheme).toHaveBeenCalledWith('modern');
  });

  it('highlights the active theme only', () => {
    render(<ThemeStyleSection uiTheme="terminal" setUiTheme={vi.fn()} />);
    const active = screen.getByText('Retro Terminal').closest('button');
    const inactive = screen.getByText('Modern Rounded').closest('button');
    expect(active.className).toContain('ring-2');
    expect(inactive.className).not.toContain('ring-2');
  });
});
