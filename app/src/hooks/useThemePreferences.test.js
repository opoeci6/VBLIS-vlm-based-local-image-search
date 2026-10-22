import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThemePreferences } from './useThemePreferences';

const stubMatchMedia = (matches) => {
  const matchMedia = vi.fn().mockReturnValue({ matches });
  vi.stubGlobal('matchMedia', matchMedia);
  window.matchMedia = matchMedia;
  return matchMedia;
};

describe('useThemePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.matchMedia;
  });

  it('reads the initial values from localStorage', () => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('ui_theme_style', 'terminal');
    const matchMedia = stubMatchMedia(true);

    const { result } = renderHook(() => useThemePreferences());
    expect(result.current.theme).toBe('light');
    expect(result.current.uiTheme).toBe('terminal');
    expect(matchMedia).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-style')).toBe('terminal');
  });

  it('falls back to prefers-color-scheme: dark when nothing is saved', () => {
    const matchMedia = stubMatchMedia(true);
    const { result } = renderHook(() => useThemePreferences());
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(result.current.theme).toBe('dark');
    expect(result.current.uiTheme).toBe('modern');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('falls back to light when the system prefers light', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useThemePreferences());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles the dark class, sets data-theme-style and persists both keys', () => {
    localStorage.setItem('theme', 'light');
    const { result } = renderHook(() => useThemePreferences());
    expect(document.documentElement.getAttribute('data-theme-style')).toBe('modern');
    expect(localStorage.getItem('ui_theme_style')).toBe('modern');

    act(() => result.current.setTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');

    act(() => result.current.setUiTheme('terminal'));
    expect(document.documentElement.getAttribute('data-theme-style')).toBe('terminal');
    expect(localStorage.getItem('ui_theme_style')).toBe('terminal');

    act(() => result.current.setUiTheme('modern'));
    expect(document.documentElement.getAttribute('data-theme-style')).toBe('modern');
    expect(localStorage.getItem('ui_theme_style')).toBe('modern');
  });
});
