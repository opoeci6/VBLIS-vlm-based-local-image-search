import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resetEscapeKeyForTests } from '../hooks/useEscapeKey';
import { stubPageHost } from '../test/pageHost';
import { ConnectionErrorScreen, LoadingScreen, SignInScreen } from './SessionScreens';

// The sign-in, loading and connection-error screens only show in a browser, which has no title bar. They have a
// small floating control instead, with the style and light or dark switches.
describe('the session screens', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    cleanup();
    resetEscapeKeyForTests();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  const screens = {
    'sign-in': () => <SignInScreen onSignIn={vi.fn()} />,
    loading: () => <LoadingScreen />,
    'connection error': () => <ConnectionErrorScreen onRetry={vi.fn()} />,
  };

  Object.entries(screens).forEach(([name, renderScreen]) => {
    it(`show no title bar and a floating control on the ${name} screen`, () => {
      const { container } = render(renderScreen());
      expect(screen.queryByTestId('title-bar')).toBeNull();
      expect(container.firstChild.className).not.toContain('pt-8');
      expect(container.firstChild.className).toContain('pt-safe');
      expect(screen.getByRole('button', { name: 'Switch to Dark Mode' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Switch UI Theme Style' })).toBeTruthy();
    });
  });

  it('switch the page to dark and to the terminal style from the control', () => {
    const { container } = render(<SignInScreen onSignIn={vi.fn()} />);
    expect(container.firstChild.className).toContain('theme-modern');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: 'Switch to Light Mode' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Switch UI Theme Style' }));
    fireEvent.click(screen.getByRole('button', { name: /Retro Terminal/ }));
    expect(container.firstChild.className).toContain('theme-terminal');
  });

  describe('the note about an unencrypted connection', () => {
    it('is a warning box above the name field, with a title and what it means', () => {
      stubPageHost('192.168.1.5');
      render(<SignInScreen onSignIn={vi.fn()} secure={false} />);
      const note = screen.getByTestId('insecure-note');
      expect(note.getAttribute('role')).toBe('note');
      expect(note.className).toContain('border-amber-300');
      expect(note.querySelector('svg')).toBeTruthy();
      expect(screen.getByText("This connection isn't encrypted").className).toContain('font-bold');
      expect(screen.getByText('Others on this network could see the pictures you open and use your sign-in. Ask the owner to turn on HTTPS.')).toBeTruthy();
      expect(note.compareDocumentPosition(screen.getByLabelText('Name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is absent over HTTPS', () => {
      stubPageHost('192.168.1.5');
      render(<SignInScreen onSignIn={vi.fn()} secure />);
      expect(screen.queryByTestId('insecure-note')).toBeNull();
    });

    it('is absent on a loopback host, where an SSH tunnel already encrypts the connection', () => {
      stubPageHost('localhost');
      render(<SignInScreen onSignIn={vi.fn()} secure={false} />);
      expect(screen.queryByTestId('insecure-note')).toBeNull();
    });
  });

  it('keep the sign-in fields at 16 px and the button at least 44 px tall', () => {
    render(<SignInScreen onSignIn={vi.fn()} />);
    expect(screen.getByLabelText('Name').className).toContain('text-base');
    expect(screen.getByLabelText('Password').className).toContain('text-base');
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('min-h-[44px]');
  });
});
