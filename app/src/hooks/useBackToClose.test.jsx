import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { setNetworkModeForTests } from '../config';
import { resetBackToCloseForTests, useBackToClose } from './useBackToClose';

// jsdom runs history traversals asynchronously and fires popstate, like a browser: wait for them to land.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const flush = () => act(async () => {});
const back = async () => {
  await act(async () => { window.history.back(); });
  await settle();
};
const level = () => window.history.state?.vblisBack ?? 0;

// Two views over one page, like a results modal with a lightbox on top. `api.set` opens or closes one.
let api;
const Views = ({ closes = {} }) => {
  const [open, setOpen] = useState({ a: false, b: false });
  api = { open, set: (name, value) => setOpen(previous => ({ ...previous, [name]: value })) };
  useBackToClose(open.a, () => {
    closes.a?.();
    setOpen(previous => ({ ...previous, a: false }));
  });
  useBackToClose(open.b, () => {
    closes.b?.();
    setOpen(previous => ({ ...previous, b: false }));
  });
  return null;
};

const openView = async (name) => {
  await act(async () => { api.set(name, true); });
};

describe('useBackToClose', () => {
  let go;
  let pushState;
  let replaceState;

  beforeEach(() => {
    setNetworkModeForTests(true);
    window.history.replaceState(null, '');
    go = vi.spyOn(window.history, 'go');
    pushState = vi.spyOn(window.history, 'pushState');
    replaceState = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(async () => {
    cleanup();
    await flush();
    await settle();
    resetBackToCloseForTests();
    setNetworkModeForTests(false);
    vi.restoreAllMocks();
    window.history.replaceState(null, '');
  });

  it('does nothing outside network mode', async () => {
    setNetworkModeForTests(false);
    render(<Views />);
    await openView('a');
    await openView('b');
    await act(async () => { api.set('a', false); api.set('b', false); });
    await settle();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('pushes exactly one history entry when a view opens, without changing the URL', async () => {
    const url = window.location.href;
    render(<Views />);
    await flush();
    expect(pushState).not.toHaveBeenCalled();
    await openView('a');
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith({ vblisBack: 1 }, '');
    expect(window.location.href).toBe(url);
    await flush();
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('keeps the rest of the history state in the entries it pushes', async () => {
    window.history.replaceState({ page: 'x' }, '');
    render(<Views />);
    await openView('a');
    expect(window.history.state).toEqual({ page: 'x', vblisBack: 1 });
  });

  it('closes the view when Back is pressed, and leaves no extra step behind', async () => {
    const closes = { a: vi.fn() };
    render(<Views closes={closes} />);
    await openView('a');
    await back();
    expect(closes.a).toHaveBeenCalledTimes(1);
    expect(api.open.a).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(level()).toBe(0);
  });

  it('goes back once when the view is closed from the screen, without calling onClose twice', async () => {
    const closes = { a: vi.fn() };
    render(<Views closes={closes} />);
    await openView('a');
    await act(async () => { api.set('a', false); });
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(closes.a).not.toHaveBeenCalled();
    expect(level()).toBe(0);
  });

  it('closes nested views one at a time, the top one first', async () => {
    const closes = { a: vi.fn(), b: vi.fn() };
    render(<Views closes={closes} />);
    await openView('a');
    await openView('b');
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(level()).toBe(2);

    await back();
    expect(closes.b).toHaveBeenCalledTimes(1);
    expect(closes.a).not.toHaveBeenCalled();
    expect(api.open).toEqual({ a: true, b: false });
    expect(level()).toBe(1);

    await back();
    expect(closes.a).toHaveBeenCalledTimes(1);
    expect(api.open).toEqual({ a: false, b: false });
    expect(level()).toBe(0);
    expect(go).not.toHaveBeenCalled();
  });

  it('goes back over both steps in one call when two views close in the same commit', async () => {
    render(<Views />);
    await openView('a');
    await openView('b');
    await act(async () => { api.set('a', false); api.set('b', false); });
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    expect(level()).toBe(0);
  });

  it('leaves no extra Back step when a view under another one is closed from the screen', async () => {
    const closes = { a: vi.fn(), b: vi.fn() };
    render(<Views closes={closes} />);
    await openView('a');
    await openView('b');

    await act(async () => { api.set('a', false); });
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect(api.open).toEqual({ a: false, b: true });

    await back();
    await settle();
    expect(closes.b).toHaveBeenCalledTimes(1);
    expect(closes.a).not.toHaveBeenCalled();
    // The step A left behind is gone too: one more go(-1), by the hook.
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(level()).toBe(0);
  });

  it('closes the top view and keeps the lower one when the top one is closed from the screen', async () => {
    const closes = { a: vi.fn(), b: vi.fn() };
    render(<Views closes={closes} />);
    await openView('a');
    await openView('b');
    await act(async () => { api.set('b', false); });
    await settle();
    expect(go).toHaveBeenCalledWith(-1);
    expect(level()).toBe(1);
    expect(api.open.a).toBe(true);
    await back();
    expect(closes.a).toHaveBeenCalledTimes(1);
    expect(closes.b).not.toHaveBeenCalled();
  });

  it('pushes once under StrictMode, which mounts effects twice', async () => {
    render(<StrictMode><Views /></StrictMode>);
    await openView('a');
    await flush();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    expect(level()).toBe(1);
  });

  it('opens one history entry per view, once, even when two views open in the same commit', async () => {
    render(<Views />);
    await act(async () => { api.set('a', true); api.set('b', true); });
    await flush();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(level()).toBe(2);
  });

  it('calls the latest onClose', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const Single = ({ onClose }) => {
      useBackToClose(true, onClose);
      return null;
    };
    const { rerender } = render(<Single onClose={first} />);
    await flush();
    rerender(<Single onClose={second} />);
    await back();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not push another entry when only onClose changes', async () => {
    const Single = ({ onClose }) => {
      useBackToClose(true, onClose);
      return null;
    };
    const { rerender } = render(<Single onClose={() => {}} />);
    await flush();
    rerender(<Single onClose={() => {}} />);
    await flush();
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('goes back over a stale entry when Forward lands on it after the view closed', async () => {
    render(<Views />);
    await openView('a');
    await back();
    expect(level()).toBe(0);
    await act(async () => { window.history.forward(); });
    await settle();
    await settle();
    expect(go).toHaveBeenCalledWith(-1);
    expect(level()).toBe(0);
    expect(api.open.a).toBe(false);
  });

  it('forgets a level left in the history state by a reload', async () => {
    window.history.replaceState({ vblisBack: 2 }, '');
    render(<Views />);
    await flush();
    await openView('a');
    expect(replaceState).toHaveBeenCalledWith({ vblisBack: 0 }, '');
    expect(level()).toBe(1);
  });
});
