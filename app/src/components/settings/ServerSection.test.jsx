import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionContext } from '../../session/sessionContext';
import { ServerSection } from './ServerSection';

const SETTINGS = {
  accounts: { owners: 1, viewers: 2 },
  library_roots: ['/srv/photos', '/srv/video'],
  port: 8765,
  tls_mode: 'self_signed',
  public_access: false,
  from_environment: ['port'],
};

const ACCOUNTS = {
  accounts: [{ id: 'a1', name: 'alice', role: 'owner', permissions: { originals: true, image_search: true, places: true }, disabled: false }],
  you: 'a1',
  limits: { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 },
};

const SESSION = {
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
    render(
      <SessionContext.Provider value={SESSION}>
        <ServerSection uiTheme={uiTheme} setToast={setToast} />
      </SessionContext.Provider>
    );
    await screen.findByText('Server facts');
  };

  beforeEach(() => {
    setToast = vi.fn();
    routes = {
      'GET /server/settings': () => reply(SETTINGS),
      'GET /server/accounts': () => reply(ACCOUNTS),
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
      render(<ServerSection uiTheme="modern" setToast={setToast} />);
      expect(screen.getByRole('status').textContent).toBe('Loading server settings...');
      await screen.findByText('Server facts');
      expect(screen.queryByText('Loading server settings...')).toBeNull();
    });

    it('has a title of its own, unless the page it sits on carries it', async () => {
      render(<ServerSection uiTheme="modern" setToast={setToast} />);
      expect(screen.getByRole('heading', { name: 'Server' })).toBeTruthy();
      cleanup();
      render(<ServerSection uiTheme="modern" setToast={setToast} showTitle={false} />);
      expect(screen.queryByRole('heading', { name: 'Server' })).toBeNull();
      await screen.findByText('Server facts');
      expect(screen.queryByRole('heading', { name: 'Server' })).toBeNull();
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

  describe('accounts', () => {
    it('summarises the accounts', async () => {
      await renderSection();
      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy();
      expect(screen.getByText('1 owner, 2 viewers')).toBeTruthy();
    });

    it.each([
      [{ owners: 2, viewers: 1 }, '2 owners, 1 viewer'],
      [{ owners: 1, viewers: 0 }, '1 owner, 0 viewers'],
    ])('uses singular and plural forms for %o', async (counts, text) => {
      routes['GET /server/settings'] = () => reply({ ...SETTINGS, accounts: counts });
      await renderSection();
      expect(screen.getByText(text)).toBeTruthy();
    });

    it('shows no summary when the server gives no counts', async () => {
      routes['GET /server/settings'] = () => reply({ ...SETTINGS, accounts: undefined });
      await renderSection();
      expect(screen.queryByText(/viewer/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Manage accounts' })).toBeTruthy();
    });

    it('has no permission switches or password forms any more', async () => {
      await renderSection();
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryByText('What viewers may do')).toBeNull();
      expect(screen.queryByLabelText('New password')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Remove viewer password/ })).toBeNull();
    });

    it('opens the accounts dialog and reads the settings again when it closes', async () => {
      await renderSection();
      expect(requests('GET /server/settings')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }));
      const dialog = await screen.findByRole('dialog', { name: 'Accounts' });
      await waitFor(() => expect(requests('GET /server/accounts')).toHaveLength(1));

      routes['GET /server/settings'] = () => reply({ ...SETTINGS, accounts: { owners: 1, viewers: 3 } });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Accounts' })).toBeNull();
      expect(dialog.isConnected).toBe(false);
      await screen.findByText('1 owner, 3 viewers');
      expect(requests('GET /server/settings')).toHaveLength(2);
    });

    it('keeps the old summary when the re-read fails', async () => {
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }));
      await screen.findByRole('dialog', { name: 'Accounts' });
      routes['GET /server/settings'] = () => reply({ detail: 'x' }, 500);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(requests('GET /server/settings')).toHaveLength(2));
      expect(screen.getByText('1 owner, 2 viewers')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('works in the terminal style too', async () => {
      await renderSection('terminal');
      fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }));
      expect(await screen.findByRole('dialog', { name: 'Accounts' })).toBeTruthy();
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
