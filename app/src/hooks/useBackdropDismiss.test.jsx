import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useBackdropDismiss } from './useBackdropDismiss';

const Overlay = ({ onDismiss }) => {
  const backdropDismiss = useBackdropDismiss(onDismiss);
  return (
    <div>
      <div data-testid="backdrop" {...backdropDismiss}>
        <p data-testid="inner">inner text</p>
      </div>
      <p data-testid="outside">outside text</p>
    </div>
  );
};

const select = (node) => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

describe('useBackdropDismiss', () => {
  afterEach(() => {
    cleanup();
    window.getSelection().removeAllRanges();
  });

  const setup = () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    return { onDismiss, backdrop: screen.getByTestId('backdrop'), inner: screen.getByTestId('inner'), outside: screen.getByTestId('outside') };
  };

  it('dismisses on a plain click on the backdrop', () => {
    const { onDismiss, backdrop } = setup();
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on mousedown plus click on the backdrop', () => {
    const { onDismiss, backdrop } = setup();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when the press began on an inner element', () => {
    const { onDismiss, backdrop, inner } = setup();
    fireEvent.mouseDown(inner);
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not dismiss when the click target is an inner element', () => {
    const { onDismiss, inner } = setup();
    fireEvent.click(inner);
    fireEvent.mouseDown(inner);
    fireEvent.click(inner);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not dismiss while text inside the overlay is selected', () => {
    const { onDismiss, backdrop, inner } = setup();
    select(inner);
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a selection elsewhere in the page', () => {
    const { onDismiss, backdrop, outside } = setup();
    select(outside);
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores a collapsed selection inside the overlay', () => {
    const { onDismiss, backdrop, inner } = setup();
    window.getSelection().collapse(inner.firstChild, 2);
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forgets the press after each click', () => {
    const { onDismiss, backdrop, inner } = setup();
    fireEvent.mouseDown(inner);
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();

    // The next click has no press recorded (synthetic or keyboard), so it dismisses.
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forgets a backdrop press after the click too', () => {
    const { onDismiss, backdrop, inner } = setup();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(inner);
    fireEvent.mouseDown(inner);
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps the handlers stable and calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useBackdropDismiss(cb), { initialProps: { cb: first } });
    const initial = result.current;
    rerender({ cb: second });
    expect(result.current).toBe(initial);

    const target = document.createElement('div');
    result.current.onClick({ target, currentTarget: target });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
