import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { resetEscapeKeyForTests, useEscapeKey } from './useEscapeKey';

const View = ({ active = true, onEscape }) => {
  useEscapeKey(active, onEscape);
  return null;
};

const Two = ({ lower, upper, upperActive = true }) => (
  <>
    <View onEscape={lower} />
    {upperActive && <View onEscape={upper} />}
  </>
);

const pressEscape = (init = {}) => fireEvent.keyDown(document.body, { key: 'Escape', ...init });

describe('useEscapeKey', () => {
  afterEach(() => {
    cleanup();
    resetEscapeKeyForTests();
  });

  it('calls the handler of the only active view', () => {
    const onEscape = vi.fn();
    render(<View onEscape={onEscape} />);
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', () => {
    const onEscape = vi.fn();
    render(<View active={false} onEscape={onEscape} />);
    pressEscape();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('closes only the view on top, then the one under it', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const { rerender } = render(<Two lower={lower} upper={upper} />);
    pressEscape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    rerender(<Two lower={lower} upper={upper} upperActive={false} />);
    pressEscape();
    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);
  });

  it('stops the event so document listeners do not also act on it', () => {
    const onDocument = vi.fn();
    document.addEventListener('keydown', onDocument);
    render(<View onEscape={vi.fn()} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    document.removeEventListener('keydown', onDocument);
    expect(event.defaultPrevented).toBe(true);
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('lets other keys, Esc with a modifier, and Esc without any active view through', () => {
    const onEscape = vi.fn();
    const onDocument = vi.fn();
    document.addEventListener('keydown', onDocument);
    const { unmount } = render(<View onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    pressEscape({ ctrlKey: true });
    unmount();
    pressEscape();
    document.removeEventListener('keydown', onDocument);
    expect(onEscape).not.toHaveBeenCalled();
    expect(onDocument).toHaveBeenCalledTimes(3);
  });

  it('ignores an Esc that something else already handled', () => {
    const onEscape = vi.fn();
    render(<View onEscape={onEscape} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('uses the latest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<View onEscape={first} />);
    rerender(<View onEscape={second} />);
    pressEscape();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('registers once under StrictMode', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render(<StrictMode><Two lower={lower} upper={upper} /></StrictMode>);
    pressEscape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });
});
