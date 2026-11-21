import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionContext } from '../../session/sessionContext';
import { AccountSection } from './AccountSection';

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

const makeSession = (overrides = {}) => ({
  mode: 'network',
  signedIn: true,
  role: 'viewer',
  isOwner: false,
  account: { id: 'v1', name: 'bob' },
  permissions: { originals: false, image_search: true, places: true },
  may: () => false,
  signOut: vi.fn(),
  refresh: vi.fn(),
  ...overrides,
});

describe('AccountSection', () => {
  let routes;
  let fetchMock;
  let setToast;
  let session;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderSection = () => render(
    <SessionContext.Provider value={session}>
      <AccountSection uiTheme="modern" setToast={setToast} />
    </SessionContext.Provider>
  );

  const fill = ({ current = 'old-pass-1', next = 'new-password-1', repeat = next } = {}) => {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: repeat } });
  };

  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

  beforeEach(() => {
    setToast = vi.fn();
    session = makeSession();
    routes = {};
    fetchMock = vi.fn(async (url, init) => {
      const key = `${init?.method || 'GET'} ${new URL(String(url)).pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`unexpected ${key}`);
      return handler(init);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('has a title of its own, unless the page it sits on carries it', () => {
    renderSection();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
    cleanup();
    render(
      <SessionContext.Provider value={session}>
        <AccountSection uiTheme="modern" setToast={setToast} showTitle={false} />
      </SessionContext.Provider>
    );
    expect(screen.queryByRole('heading', { name: 'Your account' })).toBeNull();
    expect(screen.getByText('Change password')).toBeTruthy();
  });

  it('shows the name and the role of the signed-in account', () => {
    renderSection();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText('Viewer')).toBeTruthy();
  });

  it('shows Owner for an owner', () => {
    session = makeSession({ role: 'owner', isOwner: true, account: { id: 'a1', name: 'alice' } });
    renderSection();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('has a hidden username field for password managers', () => {
    const { container } = renderSection();
    const username = container.querySelector('input[autocomplete="username"]');
    expect(username.value).toBe('bob');
    expect(username.readOnly).toBe(true);
    expect(username.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password');
  });

  describe('checks before asking the server', () => {
    it.each([
      ['the two new passwords differ', { next: 'new-password-1', repeat: 'new-password-2' }, 'The two new passwords do not match.'],
      ['the new password is too short', { next: 'short' }, 'The password must be at least 8 characters.'],
      ['the new password is too long', { next: 'x'.repeat(257) }, 'The password must be at most 256 characters.'],
      ['the current password is empty', { current: '' }, 'Enter your current password.'],
    ])('blocks the request when %s', async (_name, values, message) => {
      renderSection();
      fill(values);
      submit();
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(requests('POST /auth/password')).toHaveLength(0);
    });

    it('reports a mismatch before a length problem, and a length problem before the empty current password', async () => {
      renderSection();
      fill({ current: '', next: 'short', repeat: 'other' });
      submit();
      expect((await screen.findByRole('alert')).textContent).toBe('The two new passwords do not match.');
      fill({ current: '', next: 'short' });
      submit();
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The password must be at least 8 characters.'));
    });

    it('accepts exactly 8 and exactly 256 characters', async () => {
      routes['POST /auth/password'] = () => reply({ status: 'success' });
      renderSection();
      fill({ next: '12345678' });
      submit();
      await waitFor(() => expect(requests('POST /auth/password')).toHaveLength(1));
      fill({ next: 'y'.repeat(256) });
      submit();
      await waitFor(() => expect(requests('POST /auth/password')).toHaveLength(2));
    });
  });

  it('posts the change, toasts and clears the three fields', async () => {
    routes['POST /auth/password'] = () => reply({ status: 'success' });
    renderSection();
    fill();
    submit();
    await waitFor(() => expect(setToast).toHaveBeenCalledWith({
      message: 'Your password was changed. Your other browsers were signed out.',
      type: 'success',
    }));
    expect(requests('POST /auth/password')[0].body).toEqual({ current_password: 'old-pass-1', new_password: 'new-password-1' });
    expect(screen.getByLabelText('Current password').value).toBe('');
    expect(screen.getByLabelText('New password').value).toBe('');
    expect(screen.getByLabelText('Repeat the new password').value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the busy state while saving', async () => {
    let finish;
    routes['POST /auth/password'] = () => new Promise((resolve) => { finish = () => resolve(reply({ status: 'success' })); });
    renderSection();
    fill();
    submit();
    const button = await screen.findByRole('button', { name: 'Saving...' });
    expect(button.disabled).toBe(true);
    finish();
    await screen.findByRole('button', { name: 'Change password' });
  });

  it('shows the server error and keeps the fields', async () => {
    routes['POST /auth/password'] = () => reply({ detail: 'English', code: 'wrong_password' }, 403);
    renderSection();
    fill();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('The current password is wrong.');
    expect(setToast).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New password').value).toBe('new-password-1');
    expect(screen.getByLabelText('Current password').value).toBe('old-pass-1');
  });

  it('shows the wait on a 429', async () => {
    routes['POST /auth/password'] = () => reply({ detail: 'Too many' }, 429, { 'Retry-After': '9' });
    renderSection();
    fill();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 9 seconds.');
  });

  it('signs out with the Sign out button', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});
