import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToast } from './useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it('auto-clears after 4000 ms', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast({ message: 'hi', type: 'success' }));
    expect(result.current.toast).toEqual({ message: 'hi', type: 'success' });

    act(() => { vi.advanceTimersByTime(3999); });
    expect(result.current.toast).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toast).toBeNull();
  });

  it('restarts the timer when a new toast arrives', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast({ message: 'first', type: 'info' }));
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => result.current.setToast({ message: 'second', type: 'error' }));

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.toast).toEqual({ message: 'second', type: 'error' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.toast).toBeNull();
  });

  it('can be dismissed manually', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast({ message: 'x', type: 'info' }));
    act(() => result.current.setToast(null));
    expect(result.current.toast).toBeNull();
  });
});
