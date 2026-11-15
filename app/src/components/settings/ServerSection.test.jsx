import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServerSection } from './ServerSection';

const SETTINGS = {
  viewer_permissions: { originals: false, image_search: true },
  viewer_password_set: true,
  library_roots: ['/srv/photos', '/srv/video'],
  port: 8765,
  tls_mode: 'self_signed',
  public_access: false,
  from_environment: ['port'],
};

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

describe('ServerSection', () => {
  let routes;
  let fetchMock;
  let setToast;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderSection = async (uiTheme = 'modern') => {
    render(<ServerSection uiTheme={uiTheme} setToast={setToast} />);
    await screen.findByText('What viewers may do');
  };

  const fillPassword = ({ next = 'new-password-1', repeat = next, current = 'owner-pass' } = {}) => {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: repeat } });
    fireEvent.change(screen.getByLabelText('Current owner password'), { target: { value: current } });
  };

  const submitPassword = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

  beforeEach(() => {
    setToast = vi.fn();
    routes = {
      'GET /server/settings': () => reply(SETTINGS),
    };
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

  describe('loading', () => {
    it('shows a loading line, then the settings', async () => {
      await renderSection();
      expect(screen.queryByText('Loading server settings...')).toBeNull();
      expect(screen.getByRole('switch', { name: 'Open and download original files' }).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByRole('switch', { name: 'Search with a picture' }).getAttribute('aria-checked')).toBe('true');
    });

    it('says so when the settings cannot be loaded', async () => {
      routes['GET /server/settings'] = () => reply({ detail: 'x' }, 500);
      render(<ServerSection uiTheme="modern" setToast={setToast} />);
      expect((await screen.findByRole('alert')).textContent).toBe('Could not load the server settings.');
    });
  });

  describe('facts', () => {
    it('shows the read-only facts and where to change them', async () => {
      await renderSection();
      expect(screen.getByText('/srv/photos')).toBeTruthy();
      expect(screen.getByText('/srv/video')).toBeTruthy();
      expect(screen.getByText('8765')).toBeTruthy();
      expect(screen.getByText('On (self-signed certificate)')).toBeTruthy();
      expect(screen.getByText('Local network only')).toBeTruthy();
      expect(screen.getByText('Set by environment variables: port')).toBeTruthy();
      expect(screen.getByText('These are changed on the server. See SERVER.md.')).toBeTruthy();
    });

    it('tells when no library folder is set', async () => {
      routes['GET /server/settings'] = () => reply({ ...SETTINGS, library_roots: [], from_environment: [], tls_mode: 'off', public_access: true });
      await renderSection();
      expect(screen.getByText('None yet')).toBeTruthy();
      expect(screen.getByText('Off')).toBeTruthy();
      expect(screen.getByText('Allowed')).toBeTruthy();
      expect(screen.queryByText(/environment variables/)).toBeNull();
    });
  });

  describe('viewer permissions', () => {
    it('saves a toggle at once with a PUT of just that permission and shows the answer', async () => {
      routes['PUT /server/viewer-permissions'] = () => reply({ ...SETTINGS, viewer_permissions: { originals: true, image_search: true } });
      await renderSection();
      fireEvent.click(screen.getByRole('switch', { name: 'Open and download original files' }));
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Open and download original files' }).getAttribute('aria-checked')).toBe('true'));
      expect(requests('PUT /server/viewer-permissions')).toEqual([
        expect.objectContaining({ body: { originals: true }, init: expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }) }),
      ]);
    });

    it('turns the picture search off with image_search: false', async () => {
      routes['PUT /server/viewer-permissions'] = () => reply({ ...SETTINGS, viewer_permissions: { originals: false, image_search: false } });
      await renderSection();
      fireEvent.click(screen.getByRole('switch', { name: 'Search with a picture' }));
      await waitFor(() => expect(requests('PUT /server/viewer-permissions')[0].body).toEqual({ image_search: false }));
    });

    it('keeps the old value and toasts when saving fails', async () => {
      routes['PUT /server/viewer-permissions'] = () => reply({ detail: 'no' }, 500);
      await renderSection();
      fireEvent.click(screen.getByRole('switch', { name: 'Open and download original files' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Could not save the viewer permissions.', type: 'error' }));
      expect(screen.getByRole('switch', { name: 'Open and download original files' }).getAttribute('aria-checked')).toBe('false');
    });

    it('works in the terminal style too', async () => {
      routes['PUT /server/viewer-permissions'] = () => reply(SETTINGS);
      await renderSection('terminal');
      fireEvent.click(screen.getByRole('switch', { name: 'Open and download original files' }));
      await waitFor(() => expect(requests('PUT /server/viewer-permissions')).toHaveLength(1));
    });
  });

  describe('change password', () => {
    it('checks that the two new passwords match, before asking the server', async () => {
      await renderSection();
      fillPassword({ next: 'new-password-1', repeat: 'new-password-2' });
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('The two new passwords do not match.');
      expect(requests('POST /server/password')).toHaveLength(0);
    });

    it('checks the length: at least 8 and at most 256', async () => {
      await renderSection();
      fillPassword({ next: 'short' });
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('The password must be at least 8 characters.');
      fillPassword({ next: 'x'.repeat(257) });
      submitPassword();
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The password must be at most 256 characters.'));
      expect(requests('POST /server/password')).toHaveLength(0);
    });

    it('accepts exactly 8 and exactly 256 characters', async () => {
      routes['POST /server/password'] = () => reply(SETTINGS);
      await renderSection();
      fillPassword({ next: '12345678' });
      submitPassword();
      await waitFor(() => expect(requests('POST /server/password')).toHaveLength(1));
      fillPassword({ next: 'y'.repeat(256) });
      submitPassword();
      await waitFor(() => expect(requests('POST /server/password')).toHaveLength(2));
    });

    it('needs the current owner password', async () => {
      await renderSection();
      fillPassword({ current: '' });
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('Enter the current owner password.');
      expect(requests('POST /server/password')).toHaveLength(0);
    });

    it('posts the owner change by default, toasts, and clears the fields', async () => {
      routes['POST /server/password'] = () => reply(SETTINGS);
      await renderSection();
      fillPassword();
      submitPassword();
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The owner password was changed.', type: 'success' }));
      expect(requests('POST /server/password')[0].body).toEqual({ role: 'owner', new_password: 'new-password-1', current_password: 'owner-pass' });
      expect(screen.getByLabelText('New password').value).toBe('');
      expect(screen.getByLabelText('Current owner password').value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('can change the viewer password', async () => {
      routes['POST /server/password'] = () => reply(SETTINGS);
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Viewer' }));
      fillPassword();
      submitPassword();
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The viewer password was changed.', type: 'success' }));
      expect(requests('POST /server/password')[0].body.role).toBe('viewer');
    });

    it.each([
      ['wrong_password', 403, 'The current password is wrong.'],
      ['empty', 400, "The new password can't be empty."],
      ['too_short', 400, 'The new password is too short.'],
      ['too_long', 400, 'The new password is too long.'],
      ['same_as_other', 400, 'The owner and viewer passwords must be different.'],
      ['config_unreadable', 409, "The server's settings file could not be read, so nothing was changed."],
    ])('shows the %s error from the server', async (code, status, message) => {
      routes['POST /server/password'] = () => reply({ detail: 'English detail', code }, status);
      await renderSection();
      fillPassword();
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(setToast).not.toHaveBeenCalled();
      // The fields are kept so the user can correct them.
      expect(screen.getByLabelText('New password').value).toBe('new-password-1');
    });

    it('falls back to the server detail for an unknown code', async () => {
      routes['POST /server/password'] = () => reply({ detail: 'Something odd happened', code: 'brand_new' }, 400);
      await renderSection();
      fillPassword();
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('Something odd happened');
    });

    it('shows the wait on a 429', async () => {
      routes['POST /server/password'] = () => reply({ detail: 'Too many' }, 429, { 'Retry-After': '17' });
      await renderSection();
      fillPassword();
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 17 seconds.');
    });

    it('reports a network error', async () => {
      routes['POST /server/password'] = () => { throw new TypeError('offline'); };
      await renderSection();
      fillPassword();
      submitPassword();
      expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
    });
  });

  describe('remove viewer password', () => {
    it('is offered only when a viewer password is set', async () => {
      routes['GET /server/settings'] = () => reply({ ...SETTINGS, viewer_password_set: false });
      await renderSection();
      expect(screen.queryByRole('button', { name: 'Remove viewer password' })).toBeNull();
    });

    it('asks for the current owner password and posts it', async () => {
      routes['POST /server/viewer-password/remove'] = () => reply({ ...SETTINGS, viewer_password_set: false });
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Remove viewer password' }));
      expect(screen.getByText(/Viewers will no longer be able to sign in/)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Remove password' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Enter the current owner password.');
      expect(requests('POST /server/viewer-password/remove')).toHaveLength(0);

      fireEvent.change(screen.getAllByLabelText('Current owner password').at(-1), { target: { value: 'owner-pass' } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove password' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The viewer password was removed.', type: 'success' }));
      expect(requests('POST /server/viewer-password/remove')[0].body).toEqual({ current_password: 'owner-pass' });
      // The viewer password is gone, so the control goes too.
      expect(screen.queryByRole('button', { name: 'Remove viewer password' })).toBeNull();
    });

    it('shows the server error and can be cancelled', async () => {
      routes['POST /server/viewer-password/remove'] = () => reply({ detail: 'x', code: 'wrong_password' }, 403);
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Remove viewer password' }));
      fireEvent.change(screen.getAllByLabelText('Current owner password').at(-1), { target: { value: 'nope' } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove password' }));
      await waitFor(() => expect(screen.getAllByRole('alert').at(-1).textContent).toBe('The current password is wrong.'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Remove viewer password' })).toBeTruthy();
    });
  });

  describe('sign out other browsers', () => {
    it('asks for a confirmation first and can be cancelled', async () => {
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out other browsers' }));
      expect(screen.getByText(/This browser stays signed in/)).toBeTruthy();
      expect(requests('POST /auth/sign-out-everywhere')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Sign out other browsers' })).toBeTruthy();
      expect(requests('POST /auth/sign-out-everywhere')).toHaveLength(0);
    });

    it('posts it after the confirmation and toasts', async () => {
      routes['POST /auth/sign-out-everywhere'] = () => reply({ ok: true });
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out other browsers' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign out other browsers' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Other browsers were signed out.', type: 'success' }));
      expect(requests('POST /auth/sign-out-everywhere')).toHaveLength(1);
      expect(requests('POST /auth/sign-out-everywhere')[0].init.body).toBeUndefined();
    });

    it('toasts the failure', async () => {
      routes['POST /auth/sign-out-everywhere'] = () => reply({ detail: 'Server said no' }, 500);
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out other browsers' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign out other browsers' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Server said no', type: 'error' }));
    });
  });
});
