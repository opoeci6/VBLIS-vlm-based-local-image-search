import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from './i18n';
import { SessionContext } from './session/sessionContext';
import TitleBar from './TitleBar';

const NETWORK_SESSION = {
  mode: 'network',
  signedIn: true,
  role: 'owner',
  isOwner: true,
  account: { id: 'a1', name: 'alice' },
  permissions: { originals: true, image_search: true, places: true },
  may: () => true,
  signOut: vi.fn(),
  refresh: vi.fn(),
};

const renderBar = (props = {}, session) => {
  const bar = <TitleBar theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={vi.fn()} {...props} />;
  return render(session ? <SessionContext.Provider value={session}>{bar}</SessionContext.Provider> : bar);
};

describe('TitleBar sharing pill', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows "Sharing" while the desktop app shares', () => {
    renderBar({ sharingRunning: true });
    const pill = screen.getByRole('button', { name: 'Sharing' });
    expect(pill.className).toContain('emerald');
    expect(pill.getAttribute('title')).toBe('Sharing on the network. Open the sharing settings.');
    expect(screen.queryByRole('button', { name: 'Not sharing' })).toBeNull();
  });

  it('shows an amber "Not sharing" when sharing should run but cannot', () => {
    renderBar({ sharingRunning: false, sharingProblem: 'port_in_use' });
    const pill = screen.getByRole('button', { name: 'Not sharing' });
    expect(pill.className).toContain('amber');
    expect(pill.getAttribute('title')).toBe("Sharing should be on but isn't running. Open the sharing settings.");
    expect(screen.queryByRole('button', { name: 'Sharing' })).toBeNull();
  });

  it('shows no pill when sharing is off, or when the status has no sharing at all', () => {
    renderBar({ sharingRunning: false, sharingProblem: null });
    expect(screen.queryByRole('button', { name: 'Sharing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not sharing' })).toBeNull();
    cleanup();
    renderBar();
    expect(screen.queryByRole('button', { name: 'Sharing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not sharing' })).toBeNull();
  });

  it('opens the settings when the pill is clicked, in both states', () => {
    const onOpenSharing = vi.fn();
    renderBar({ sharingRunning: true, onOpenSharing });
    fireEvent.click(screen.getByRole('button', { name: 'Sharing' }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    cleanup();

    const onOpenProblem = vi.fn();
    renderBar({ sharingProblem: 'no_accounts', onOpenSharing: onOpenProblem });
    fireEvent.click(screen.getByRole('button', { name: 'Not sharing' }));
    expect(onOpenProblem).toHaveBeenCalledTimes(1);
  });

  it('has no pill in a browser signed in to the network server', () => {
    renderBar({ sharingRunning: true, sharingProblem: 'port_in_use' }, NETWORK_SESSION);
    expect(screen.queryByRole('button', { name: 'Sharing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not sharing' })).toBeNull();
  });

  it('is in Chinese too', async () => {
    await i18n.changeLanguage('zh-CN');
    renderBar({ sharingRunning: true });
    expect(screen.getByRole('button', { name: '共享中' })).toBeTruthy();
    cleanup();
    renderBar({ sharingProblem: 'port_in_use' });
    expect(screen.getByRole('button', { name: '未在共享' })).toBeTruthy();
  });
});
