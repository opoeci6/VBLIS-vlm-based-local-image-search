import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HttpWarningBanner, HTTP_WARNING_DISMISSED_KEY } from './HttpWarningBanner';
import { SessionProvider } from '../../session/SessionProvider';

const info = (role, secure) => ({
  signed_in: true,
  role,
  account: { id: 'a1', name: 'alice' },
  permissions: { originals: true, image_search: true, places: true },
  secure,
  case_sensitive_paths: true,
});

const inSession = (session) => render(
  <SessionProvider info={session} onSignOut={vi.fn()}><HttpWarningBanner /></SessionProvider>
);

const MESSAGE = "This connection isn't encrypted. Others on this network could see your password and pictures.";

describe('HttpWarningBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('shows on plain HTTP', () => {
    inSession(info('owner', false));
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('is not shown over HTTPS', () => {
    const { container } = inSession(info('owner', true));
    expect(container.firstChild).toBeNull();
  });

  it('is not shown on the desktop', () => {
    const { container } = render(<HttpWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('tells the owner the ways to turn HTTPS on', () => {
    inSession(info('owner', false));
    expect(screen.queryByText(/set tls self_signed/)).toBeNull();
    const toggle = screen.getByRole('button', { name: /How to turn on HTTPS/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('code').textContent).toBe('set tls self_signed');
    expect(screen.getByText(/certificate and key files/)).toBeTruthy();
    expect(screen.getByText(/reverse proxy/)).toBeTruthy();
    expect(screen.getByText('See SERVER.md for the steps.')).toBeTruthy();
    expect(screen.queryByText("Ask the server's owner to turn on HTTPS.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(/reverse proxy/)).toBeNull();
  });

  it('tells a viewer to ask the owner', () => {
    inSession(info('viewer', false));
    fireEvent.click(screen.getByRole('button', { name: /How to turn on HTTPS/ }));
    expect(screen.getByText("Ask the server's owner to turn on HTTPS.")).toBeTruthy();
    expect(screen.queryByText(/set tls/)).toBeNull();
  });

  it('can be dismissed, and stays dismissed in this browser', () => {
    const first = inSession(info('owner', false));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(JSON.parse(localStorage.getItem(HTTP_WARNING_DISMISSED_KEY))).toBe(true);
    first.unmount();

    const second = inSession(info('viewer', false));
    expect(second.container.firstChild).toBeNull();
  });

  it('uses the key http_warning_dismissed', () => {
    expect(HTTP_WARNING_DISMISSED_KEY).toBe('http_warning_dismissed');
  });

  it('uses the small phone padding and a 40 px dismiss target', () => {
    const { container } = inSession(info('owner', false));
    expect(container.firstChild.className).toContain('px-4');
    expect(container.firstChild.className).toContain('sm:px-6');
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toContain('p-3');
  });
});
