import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { resetEscapeKeyForTests, useEscapeKey } from '../../hooks/useEscapeKey';
import { SessionContext } from '../../session/sessionContext';
import { HeaderMenu } from './HeaderMenu';

const networkSession = (overrides = {}) => ({
  mode: 'network',
  signedIn: true,
  role: 'owner',
  isOwner: true,
  account: { id: 'a1', name: 'alice' },
  permissions: { originals: true, image_search: true, places: true },
  may: () => true,
  signOut: vi.fn(),
  refresh: vi.fn(),
  ...overrides,
});

const renderMenu = ({ session = networkSession(), props = {}, extra = null } = {}) => {
  const handlers = { setTheme: vi.fn(), setUiTheme: vi.fn() };
  const view = render(
    <SessionContext.Provider value={session}>
      <div data-testid="outside">outside</div>
      {extra}
      <HeaderMenu theme="light" uiTheme="modern" {...handlers} {...props} />
    </SessionContext.Provider>
  );
  return { ...view, ...handlers, session };
};

const trigger = () => screen.getByRole('button', { name: 'Account and appearance' });
const openMenu = () => fireEvent.click(trigger());
const isOpen = () => screen.queryByText('Signed in as alice · Owner') !== null;

describe('HeaderMenu', () => {
  afterEach(async () => {
    cleanup();
    resetEscapeKeyForTests();
    await i18n.changeLanguage('en');
  });

  it('is one button with the account name next to the user icon, and the menu closed', () => {
    renderMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toBe('alice');
    // The name is hidden below sm so the button stays a 40 px square on a phone.
    expect(screen.getByText('alice').className).toContain('hidden');
    expect(screen.getByText('alice').className).toContain('sm:inline');
    expect(isOpen()).toBe(false);
  });

  it('opens on a click, shows the account and the role, and closes on a second click', () => {
    renderMenu();
    openMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Signed in as alice · Owner')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Modern Rounded/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to Dark Mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    openMenu();
    expect(isOpen()).toBe(false);
  });

  it('keeps the popover inside a 360 px screen', () => {
    renderMenu();
    openMenu();
    const popover = screen.getByText('Signed in as alice · Owner').parentElement;
    expect(popover.className).toContain('right-0');
    expect(popover.className).toContain('max-w-[calc(100vw-2rem)]');
  });

  it('says Viewer for a viewer', () => {
    renderMenu({ session: networkSession({ role: 'viewer', isOwner: false, account: { id: 'b1', name: 'bob' } }) });
    fireEvent.click(trigger());
    expect(screen.getByText('Signed in as bob · Viewer')).toBeTruthy();
  });

  it('closes on a press outside, but not on a press inside', () => {
    renderMenu();
    openMenu();
    fireEvent.mouseDown(screen.getByText('Signed in as alice · Owner'));
    expect(isOpen()).toBe(true);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(isOpen()).toBe(false);
  });

  it('closes on a touch outside', () => {
    renderMenu();
    openMenu();
    fireEvent.touchStart(screen.getByTestId('outside'));
    expect(isOpen()).toBe(false);
  });

  it('closes on Esc', () => {
    renderMenu();
    openMenu();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('closes only itself on Esc when another view is open under it, then the next Esc reaches that view', () => {
    const closeUnder = vi.fn();
    const ViewUnder = () => {
      useEscapeKey(true, closeUnder);
      return <p>view under</p>;
    };
    renderMenu({ extra: <ViewUnder /> });
    openMenu();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(closeUnder).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closeUnder).toHaveBeenCalledTimes(1);
  });

  it('chooses the style and closes', () => {
    const { setUiTheme } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Retro Terminal/ }));
    expect(setUiTheme).toHaveBeenCalledWith('terminal');
    expect(isOpen()).toBe(false);
  });

  it('marks the current style', () => {
    renderMenu({ props: { uiTheme: 'terminal' } });
    openMenu();
    expect(screen.getByRole('button', { name: /Retro Terminal/ }).querySelector('svg.lucide-check')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Modern Rounded/ }).querySelector('svg.lucide-check')).toBeNull();
  });

  it('switches between light and dark and closes', () => {
    const light = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
    expect(light.setTheme).toHaveBeenCalledWith('dark');
    expect(isOpen()).toBe(false);
    cleanup();

    const dark = renderMenu({ props: { theme: 'dark' } });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Light Mode' }));
    expect(dark.setTheme).toHaveBeenCalledWith('light');
  });

  it('signs out and closes', () => {
    const { session } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
  });

  it('works again after it was closed, with the state of its parent unchanged', () => {
    const Parent = () => {
      const [count, setCount] = useState(0);
      return (
        <SessionContext.Provider value={networkSession()}>
          <button type="button" onClick={() => setCount(count + 1)}>count {count}</button>
          <HeaderMenu theme="light" uiTheme="modern" setTheme={vi.fn()} setUiTheme={vi.fn()} />
        </SessionContext.Provider>
      );
    };
    render(<Parent />);
    openMenu();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    openMenu();
    expect(isOpen()).toBe(true);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'count 0' }));
    expect(isOpen()).toBe(false);
  });

  it('is in Chinese too', async () => {
    await i18n.changeLanguage('zh-CN');
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: '账户与外观' }));
    expect(screen.getByText('登录身份：alice · 所有者')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
  });
});
