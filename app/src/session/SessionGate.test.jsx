import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionGate } from './SessionGate';
import { useSession } from './sessionContext';
import { setNetworkModeForTests } from '../config';
import { apiFetch } from '../utils/api';
import { foldPath, setCaseSensitivePaths } from '../utils/pathCase';
import i18n from '../i18n';

const signedOutInfo = (extra = {}) => ({
  signed_in: false,
  role: null,
  permissions: { originals: false, image_search: false },
  channel: 'network',
  secure: true,
  case_sensitive_paths: false,
  path_separator: '/',
  viewer_enabled: true,
  ...extra,
});

const signedInInfo = (extra = {}) => ({
  ...signedOutInfo(),
  signed_in: true,
  role: 'owner',
  permissions: { originals: true, image_search: true },
  case_sensitive_paths: true,
  ...extra,
});

const reply = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

// Stands in for <App/>: shows what the session says and lets a test make API calls and sign out.
function Probe() {
  const { role, isOwner, mode, signOut, secure } = useSession();
  return (
    <div>
      <p>{`app: ${mode} ${role} owner=${isOwner} secure=${secure}`}</p>
      <button onClick={() => apiFetch('http://127.0.0.1:8000/status')}>call api</button>
      <button onClick={signOut}>out</button>
    </div>
  );
}

const renderGate = () => render(<SessionGate><Probe /></SessionGate>);

const signIn = async (password = 'secret') => {
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('SessionGate', () => {
  let routes;
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    routes = {};
    fetchMock = vi.fn(async (url, init) => {
      const { pathname } = new URL(String(url));
      const key = `${init?.method || 'GET'} ${pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`unexpected request ${key}`);
      return handler(init);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    setNetworkModeForTests(false);
    setCaseSensitivePaths(false);
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  describe('on the desktop', () => {
    it('renders the app at once, with no session request and the owner role', () => {
      renderGate();
      expect(screen.getByText('app: desktop owner owner=true secure=true')).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('in a browser', () => {
    beforeEach(() => setNetworkModeForTests(true));

    it('shows a loading screen while the session is being read', async () => {
      routes['GET /auth/session'] = () => new Promise(() => {});
      renderGate();
      expect(screen.getByText('Connecting to the server...')).toBeTruthy();
    });

    it('goes straight to the app when the session is signed in', async () => {
      routes['GET /auth/session'] = () => reply(200, signedInInfo({ role: 'viewer', secure: false }));
      renderGate();
      expect(await screen.findByText('app: network viewer owner=false secure=false')).toBeTruthy();
      expect(screen.queryByLabelText('Password')).toBeNull();
    });

    it('applies the server path case rule before the app renders', async () => {
      routes['GET /auth/session'] = () => reply(200, signedInInfo({ case_sensitive_paths: true }));
      renderGate();
      await screen.findByText(/^app:/);
      expect(foldPath('A/B')).toBe('A/B');
    });

    it('shows the sign-in screen when signed out, with a password field', async () => {
      routes['GET /auth/session'] = () => reply(200, signedOutInfo());
      renderGate();
      const field = await screen.findByLabelText('Password');
      expect(field.getAttribute('type')).toBe('password');
      expect(field.getAttribute('autocomplete')).toBe('current-password');
      expect(screen.getByRole('heading', { name: 'VBLIS' })).toBeTruthy();
      expect(screen.queryByText(/^app:/)).toBeNull();
      expect(screen.queryByTestId('insecure-note')).toBeNull();
    });

    it('keeps the saved theme and style on the sign-in screen', async () => {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('ui_theme_style', 'terminal');
      routes['GET /auth/session'] = () => reply(200, signedOutInfo());
      const { container } = renderGate();
      await screen.findByLabelText('Password');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(container.firstChild.className).toContain('terminal-theme');
    });

    it('notes an unencrypted connection', async () => {
      routes['GET /auth/session'] = () => reply(200, signedOutInfo({ secure: false }));
      renderGate();
      expect(await screen.findByText("This connection isn't encrypted.")).toBeTruthy();
    });

    it('offers a retry when the session cannot be read', async () => {
      routes['GET /auth/session'] = () => { throw new TypeError('offline'); };
      renderGate();
      expect(await screen.findByText("Can't reach the server")).toBeTruthy();
      routes['GET /auth/session'] = () => reply(200, signedOutInfo());
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByLabelText('Password')).toBeTruthy();
    });

    describe('signing in', () => {
      beforeEach(() => {
        routes['GET /auth/session'] = () => reply(200, signedOutInfo());
      });

      it('shows the app after a correct password and sends it as JSON', async () => {
        routes['POST /auth/login'] = () => reply(200, signedInInfo({ role: 'owner' }));
        renderGate();
        await signIn('hunter2');
        expect(await screen.findByText('app: network owner owner=true secure=true')).toBeTruthy();
        const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'));
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ password: 'hunter2' });
        expect(init.headers).not.toHaveProperty('X-VBLIS-Token');
      });

      it('does not submit an empty password', async () => {
        renderGate();
        await screen.findByLabelText('Password');
        expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(true);
      });

      it('says so when the password is wrong, and keeps the form', async () => {
        routes['POST /auth/login'] = () => reply(401, { detail: 'Wrong password' });
        renderGate();
        await signIn();
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong password.');
        expect(screen.getByLabelText('Password')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(false);
      });

      it('shows the wait when there were too many attempts', async () => {
        routes['POST /auth/login'] = () => reply(429, { detail: 'Too many attempts' }, { 'Retry-After': '42' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 42 seconds.');
      });

      it('uses the singular for one second', async () => {
        routes['POST /auth/login'] = () => reply(429, {}, { 'Retry-After': '1' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 1 second.');
      });

      it('copes with a missing Retry-After header', async () => {
        routes['POST /auth/login'] = () => reply(429, {});
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again later.');
      });

      it('tells a busy server from a missing owner password', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'Server busy' }, { 'Retry-After': '5' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('The server is busy. Try again in 5 seconds.');
      });

      it('names the command when the server has no owner password yet', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'The owner password is not set' });
        renderGate();
        await signIn();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('The server has no owner password yet. Set one on the server: set-password owner');
        expect(alert.querySelector('code').textContent).toBe('set-password owner');
      });

      it('reports a network error', async () => {
        routes['POST /auth/login'] = () => { throw new TypeError('offline'); };
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server. Check your connection and try again.');
      });

      it('shows the messages in Chinese too', async () => {
        await i18n.changeLanguage('zh-CN');
        routes['POST /auth/login'] = () => reply(429, {}, { 'Retry-After': '30' });
        renderGate();
        fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: '登录' }));
        expect((await screen.findByRole('alert')).textContent).toBe('尝试次数过多，请在 30 秒后重试。');
      });
    });

    describe('when signed in', () => {
      beforeEach(() => {
        routes['GET /auth/session'] = () => reply(200, signedInInfo());
      });

      it('returns to the sign-in screen when an API call is answered with 401', async () => {
        routes['GET /status'] = () => reply(401, { detail: 'Not signed in' });
        renderGate();
        fireEvent.click(await screen.findByText('call api'));
        expect(await screen.findByLabelText('Password')).toBeTruthy();
        expect(screen.getByText('Your session ended. Sign in again.')).toBeTruthy();
        expect(screen.queryByText(/^app:/)).toBeNull();
      });

      it('stays in the app on a 403', async () => {
        routes['GET /status'] = () => reply(403, { detail: 'Not allowed' });
        renderGate();
        fireEvent.click(await screen.findByText('call api'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(screen.getByText(/^app:/)).toBeTruthy();
      });

      it('signs out: posts the logout and shows the sign-in screen', async () => {
        routes['POST /auth/logout'] = () => reply(200, { ok: true });
        renderGate();
        fireEvent.click(await screen.findByText('out'));
        expect(await screen.findByLabelText('Password')).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/auth/logout') && init.method === 'POST')).toBe(true);
        expect(screen.queryByText('Your session ended. Sign in again.')).toBeNull();
      });

      it('can sign in again as someone else after signing out', async () => {
        routes['POST /auth/logout'] = () => reply(200, {});
        routes['POST /auth/login'] = () => reply(200, signedInInfo({ role: 'viewer' }));
        renderGate();
        fireEvent.click(await screen.findByText('out'));
        await signIn('viewer-pass');
        expect(await screen.findByText('app: network viewer owner=false secure=true')).toBeTruthy();
      });
    });
  });
});
