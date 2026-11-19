import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionGate } from './SessionGate';
import { useSession } from './sessionContext';
import { setNetworkModeForTests } from '../config';
import { apiFetch } from '../utils/api';
import { foldPath, setCaseSensitivePaths } from '../utils/pathCase';
import i18n from '../i18n';

const signedOutInfo = (extra = {}) => ({
  signed_in: false,
  role: null,
  channel: 'network',
  secure: true,
  ...extra,
});

const signedInInfo = (extra = {}) => ({
  signed_in: true,
  role: 'owner',
  account: { id: 'a1', name: 'alice' },
  permissions: { originals: true, image_search: true, places: true },
  channel: 'network',
  secure: true,
  case_sensitive_paths: true,
  path_separator: '/',
  ...extra,
});

const reply = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

let probeRenders = 0;

// Stands in for <App/>: shows what the session says and lets a test make API calls, refresh and sign out.
function Probe() {
  const { role, isOwner, mode, signOut, refresh, secure, account, may } = useSession();
  probeRenders += 1;
  return (
    <div>
      <p>{`app: ${mode} ${role} owner=${isOwner} secure=${secure}`}</p>
      <p>{`account: ${account ? account.name : 'none'} places=${may('places')}`}</p>
      <button onClick={() => apiFetch('http://127.0.0.1:8000/status')}>call api</button>
      <button onClick={() => refresh()}>refresh</button>
      <button onClick={signOut}>out</button>
    </div>
  );
}

const renderGate = () => render(<SessionGate><Probe /></SessionGate>);

const signIn = async (password = 'secret', name = 'alice') => {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('SessionGate', () => {
  let routes;
  let fetchMock;

  const sessionCalls = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/auth/session') && !init?.method).length;

  beforeEach(() => {
    localStorage.clear();
    probeRenders = 0;
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

  afterEach(async () => {
    cleanup();
    setNetworkModeForTests(false);
    setCaseSensitivePaths(false);
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  describe('on the desktop', () => {
    it('renders the app at once, with no session request and the owner role', () => {
      renderGate();
      expect(screen.getByText('app: desktop owner owner=true secure=true')).toBeTruthy();
      expect(screen.getByText('account: none places=true')).toBeTruthy();
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

    it('gives the app the account and what it may do', async () => {
      routes['GET /auth/session'] = () => reply(200, signedInInfo({
        role: 'viewer',
        account: { id: 'v1', name: 'bob' },
        permissions: { originals: false, image_search: true },
      }));
      renderGate();
      expect(await screen.findByText('account: bob places=false')).toBeTruthy();
    });

    it('applies the server path case rule before the app renders', async () => {
      routes['GET /auth/session'] = () => reply(200, signedInInfo({ case_sensitive_paths: true }));
      renderGate();
      await screen.findByText(/^app:/);
      expect(foldPath('A/B')).toBe('A/B');
    });

    it('shows the sign-in screen when signed out, with name and password fields', async () => {
      routes['GET /auth/session'] = () => reply(200, signedOutInfo());
      renderGate();
      const name = await screen.findByLabelText('Name');
      expect(name.getAttribute('type')).toBe('text');
      expect(name.getAttribute('name')).toBe('username');
      expect(name.getAttribute('autocomplete')).toBe('username');
      expect(name.getAttribute('autocapitalize')).toBe('none');
      expect(name.getAttribute('spellcheck')).toBe('false');
      const field = screen.getByLabelText('Password');
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

      it('shows the app after a correct sign-in and sends the trimmed name and the password as JSON', async () => {
        routes['POST /auth/login'] = () => reply(200, signedInInfo({ role: 'owner' }));
        renderGate();
        await signIn('hunter2', '  alice  ');
        expect(await screen.findByText('app: network owner owner=true secure=true')).toBeTruthy();
        expect(screen.getByText('account: alice places=true')).toBeTruthy();
        const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'));
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ name: 'alice', password: 'hunter2' });
        expect(init.headers).not.toHaveProperty('X-VBLIS-Token');
      });

      it('does not submit with an empty name or an empty password', async () => {
        renderGate();
        const submit = async () => screen.getByRole('button', { name: 'Sign in' });
        const name = await screen.findByLabelText('Name');
        const password = screen.getByLabelText('Password');
        expect((await submit()).disabled).toBe(true);

        fireEvent.change(password, { target: { value: 'secret' } });
        expect((await submit()).disabled).toBe(true);

        fireEvent.change(name, { target: { value: '   ' } });
        expect((await submit()).disabled).toBe(true);

        fireEvent.change(name, { target: { value: 'alice' } });
        expect((await submit()).disabled).toBe(false);

        fireEvent.change(password, { target: { value: '' } });
        expect((await submit()).disabled).toBe(true);
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/login'))).toBe(false);
      });

      it('says so when the name or the password is wrong, and keeps the form', async () => {
        routes['POST /auth/login'] = () => reply(401, { detail: 'Wrong name or password', code: 'wrong_name_or_password' });
        renderGate();
        await signIn();
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong name or password.');
        expect(screen.getByLabelText('Name')).toBeTruthy();
        expect(screen.getByLabelText('Password')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(false);
      });

      it('says when the account is turned off', async () => {
        routes['POST /auth/login'] = () => reply(403, { detail: 'Account is off', code: 'account_off' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe("This account is turned off. Ask the server's owner to turn it on.");
      });

      it('shows a generic line for a 403 without the account_off code', async () => {
        routes['POST /auth/login'] = () => reply(403, { detail: 'Forbidden' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('Sign-in failed (HTTP 403).');
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

      it('shows a busy server with the wait the server named', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'Server busy' }, { 'Retry-After': '5' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('The server is busy. Try again in 5 seconds.');
      });

      it('shows a busy server without a wait too', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'Server busy' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent).toBe('The server is busy. Try again later.');
      });

      it('names the command when the server has no owner account yet', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'There is no owner account', code: 'no_owner_account' });
        renderGate();
        await signIn();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('The server has no owner account yet. Add one on the server: add-account NAME --role owner');
        expect(alert.querySelector('code').textContent).toBe('add-account NAME --role owner');
      });

      it('points to the VBLIS app when the desktop app shares but no account can sign in', async () => {
        routes['POST /auth/login'] = () => reply(503, { detail: 'No account can sign in yet.', code: 'no_accounts' });
        renderGate();
        await signIn();
        expect((await screen.findByRole('alert')).textContent)
          .toBe('No account can sign in yet. Add one in the VBLIS app on the computer that shares.');
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
        fireEvent.change(await screen.findByLabelText('账户名'), { target: { value: 'alice' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: '登录' }));
        expect((await screen.findByRole('alert')).textContent).toBe('尝试次数过多，请在 30 秒后重试。');
      });
    });

    describe('when signed in', () => {
      let session;

      beforeEach(() => {
        session = signedInInfo();
        routes['GET /auth/session'] = () => reply(200, session);
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
        routes['POST /auth/login'] = () => reply(200, signedInInfo({ role: 'viewer', account: { id: 'v1', name: 'bob' } }));
        renderGate();
        fireEvent.click(await screen.findByText('out'));
        await signIn('viewer-pass', 'bob');
        expect(await screen.findByText('app: network viewer owner=false secure=true')).toBeTruthy();
        expect(screen.getByText('account: bob places=true')).toBeTruthy();
      });

      describe('refresh', () => {
        it('re-reads the session and shows what changed', async () => {
          renderGate();
          await screen.findByText('account: alice places=true');
          session = signedInInfo({ account: { id: 'a1', name: 'alice2' }, permissions: { originals: true, image_search: true, places: false } });
          fireEvent.click(screen.getByText('refresh'));
          expect(await screen.findByText('account: alice2 places=true')).toBeTruthy();
        });

        it('goes to the sign-in screen, with the expired note, when the session ended', async () => {
          renderGate();
          await screen.findByText(/^app:/);
          session = signedOutInfo();
          fireEvent.click(screen.getByText('refresh'));
          expect(await screen.findByLabelText('Password')).toBeTruthy();
          expect(screen.getByText('Your session ended. Sign in again.')).toBeTruthy();
          expect(screen.queryByText(/^app:/)).toBeNull();
        });

        it('keeps the app when the server cannot be reached or answers an error', async () => {
          renderGate();
          await screen.findByText(/^app:/);
          routes['GET /auth/session'] = () => { throw new TypeError('offline'); };
          fireEvent.click(screen.getByText('refresh'));
          await waitFor(() => expect(sessionCalls()).toBe(2));
          routes['GET /auth/session'] = () => reply(500, { detail: 'boom' });
          fireEvent.click(screen.getByText('refresh'));
          await waitFor(() => expect(sessionCalls()).toBe(3));
          await act(async () => {});
          expect(screen.getByText('account: alice places=true')).toBeTruthy();
          expect(screen.queryByLabelText('Password')).toBeNull();
          expect(screen.queryByText("Can't reach the server")).toBeNull();
        });

        it('does not render the app again when nothing changed', async () => {
          renderGate();
          await screen.findByText(/^app:/);
          const before = probeRenders;
          fireEvent.click(screen.getByText('refresh'));
          await waitFor(() => expect(sessionCalls()).toBe(2));
          await act(async () => {});
          expect(probeRenders).toBe(before);
        });
      });

      describe('when the tab comes back to the front', () => {
        const setVisibility = (state) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
          document.dispatchEvent(new Event('visibilitychange'));
        };

        afterEach(() => {
          delete document.visibilityState;
        });

        it('re-reads the session', async () => {
          renderGate();
          await screen.findByText('account: alice places=true');
          expect(sessionCalls()).toBe(1);

          session = signedInInfo({ account: { id: 'a1', name: 'alice3' } });
          setVisibility('visible');
          expect(await screen.findByText('account: alice3 places=true')).toBeTruthy();
          expect(sessionCalls()).toBe(2);
        });

        it('does nothing while the tab is hidden', async () => {
          renderGate();
          await screen.findByText(/^app:/);
          setVisibility('hidden');
          await act(async () => {});
          expect(sessionCalls()).toBe(1);
        });

        it('is not listened to once signed out', async () => {
          routes['POST /auth/logout'] = () => reply(200, {});
          renderGate();
          fireEvent.click(await screen.findByText('out'));
          await screen.findByLabelText('Password');
          setVisibility('visible');
          await act(async () => {});
          expect(sessionCalls()).toBe(1);
        });
      });
    });
  });
});
