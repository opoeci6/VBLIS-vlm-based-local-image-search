import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useAccounts } from './useAccounts';

const ALL = { originals: true, image_search: true, places: true };

const LIST = {
  accounts: [
    { id: 'a1', name: 'alice', role: 'owner', permissions: ALL, disabled: false },
    { id: 'v1', name: 'bob', role: 'viewer', permissions: { originals: false, image_search: true, places: true }, disabled: false },
  ],
  you: 'a1',
  limits: { max_accounts: 10, name_max: 20, password_min: 8, password_max: 256 },
};

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

describe('useAccounts', () => {
  let routes;
  let fetchMock;

  const calls = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderAccounts = async () => {
    const view = renderHook(() => useAccounts({ mode: 'network' }));
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    return view;
  };

  beforeEach(() => {
    routes = { 'GET /server/accounts': () => reply(LIST) };
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
    it('is empty with default limits until the list arrives, then holds it', async () => {
      const view = renderHook(() => useAccounts({ mode: 'network' }));
      expect(view.result.current.isLoading).toBe(true);
      expect(view.result.current.accounts).toEqual([]);
      expect(view.result.current.limits).toEqual({ max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 });
      await waitFor(() => expect(view.result.current.isLoading).toBe(false));
      expect(view.result.current.accounts).toEqual(LIST.accounts);
      expect(view.result.current.you).toBe('a1');
      expect(view.result.current.limits.name_max).toBe(20);
      expect(view.result.current.loadFailed).toBe(false);
    });

    it('merges the server limits over the defaults', async () => {
      routes['GET /server/accounts'] = () => reply({ ...LIST, limits: { max_accounts: 3 } });
      const view = await renderAccounts();
      expect(view.result.current.limits).toEqual({ max_accounts: 3, name_max: 32, password_min: 8, password_max: 256 });
    });

    it('reports a failed load and loads again on reload', async () => {
      routes['GET /server/accounts'] = () => reply({ detail: 'x' }, 500);
      const view = await renderAccounts();
      expect(view.result.current.loadFailed).toBe(true);
      expect(view.result.current.accounts).toEqual([]);
      routes['GET /server/accounts'] = () => reply(LIST);
      await act(() => view.result.current.reload());
      expect(view.result.current.loadFailed).toBe(false);
      expect(view.result.current.accounts).toHaveLength(2);
    });
  });

  describe('mutations', () => {
    const NEW_LIST = { ...LIST, accounts: [...LIST.accounts, { id: 'v2', name: 'carol', role: 'viewer', permissions: ALL, disabled: false }] };

    it('add posts a viewer with its permissions and replaces the list', async () => {
      routes['POST /server/accounts'] = () => reply(NEW_LIST);
      const view = await renderAccounts();
      const permissions = { originals: false, image_search: true, places: false };
      let result;
      await act(async () => {
        result = await view.result.current.add({ name: 'carol', role: 'viewer', password: 'pw-12345', permissions, currentPassword: 'mine' });
      });
      expect(result).toEqual({ ok: true });
      expect(calls('POST /server/accounts')).toEqual([
        expect.objectContaining({
          body: { name: 'carol', role: 'viewer', password: 'pw-12345', permissions, current_password: 'mine' },
          init: expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
        }),
      ]);
      expect(view.result.current.accounts).toHaveLength(3);
    });

    it('add sends no permissions for an owner', async () => {
      routes['POST /server/accounts'] = () => reply(NEW_LIST);
      const view = await renderAccounts();
      await act(async () => {
        await view.result.current.add({ name: 'dan', role: 'owner', password: 'pw-12345', permissions: { originals: true }, currentPassword: 'mine' });
      });
      expect(calls('POST /server/accounts')[0].body).toEqual({ name: 'dan', role: 'owner', password: 'pw-12345', current_password: 'mine' });
    });

    it('update patches only what changed, with the id encoded and no password unless given', async () => {
      routes['PATCH /server/accounts/v%2F1'] = () => reply(LIST);
      const view = await renderAccounts();
      await act(async () => { await view.result.current.update('v/1', { permissions: { places: false } }); });
      expect(calls('PATCH /server/accounts/v%2F1')[0].body).toEqual({ permissions: { places: false } });
      await act(async () => { await view.result.current.update('v/1', { name: 'robert' }, 'mine'); });
      expect(calls('PATCH /server/accounts/v%2F1')[1].body).toEqual({ name: 'robert', current_password: 'mine' });
    });

    it('update replaces the list from the answer', async () => {
      const changed = { ...LIST, accounts: [LIST.accounts[0], { ...LIST.accounts[1], disabled: true }] };
      routes['PATCH /server/accounts/v1'] = () => reply(changed);
      const view = await renderAccounts();
      await act(async () => { await view.result.current.update('v1', { disabled: true }); });
      expect(view.result.current.accounts[1].disabled).toBe(true);
    });

    it('setPassword posts the new and the current password', async () => {
      routes['POST /server/accounts/v1/password'] = () => reply(LIST);
      const view = await renderAccounts();
      let result;
      await act(async () => { result = await view.result.current.setPassword('v1', 'new-pass-1', 'mine'); });
      expect(result).toEqual({ ok: true });
      expect(calls('POST /server/accounts/v1/password')[0].body).toEqual({ new_password: 'new-pass-1', current_password: 'mine' });
    });

    it('signOut posts with no body and no Content-Type', async () => {
      routes['POST /server/accounts/v1/sign-out'] = () => reply(LIST);
      const view = await renderAccounts();
      await act(async () => { await view.result.current.signOut('v1'); });
      const [call] = calls('POST /server/accounts/v1/sign-out');
      expect(call.init).toEqual({ method: 'POST' });
    });

    it('remove posts the current password to /delete and takes the shorter list', async () => {
      routes['POST /server/accounts/v1/delete'] = () => reply({ ...LIST, accounts: [LIST.accounts[0]] });
      const view = await renderAccounts();
      await act(async () => { await view.result.current.remove('v1', 'mine'); });
      expect(calls('POST /server/accounts/v1/delete')[0].body).toEqual({ current_password: 'mine' });
      expect(view.result.current.accounts).toHaveLength(1);
    });
  });

  describe('refusals', () => {
    it('keeps the list and returns the translated message of a known code', async () => {
      routes['POST /server/accounts/v1/delete'] = () => reply({ detail: 'English', code: 'wrong_password' }, 403);
      const view = await renderAccounts();
      let result;
      await act(async () => { result = await view.result.current.remove('v1', 'nope'); });
      expect(result).toEqual({ ok: false, status: 403, code: 'wrong_password', message: 'The current password is wrong.' });
      expect(view.result.current.accounts).toEqual(LIST.accounts);
    });

    it('falls back to the detail for an unknown code, then to a generic line', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply({ detail: 'Something odd', code: 'brand_new' }, 400);
      const view = await renderAccounts();
      let result;
      await act(async () => { result = await view.result.current.update('v1', { name: 'x' }); });
      expect(result.message).toBe('Something odd');
      expect(result.code).toBe('brand_new');
      routes['PATCH /server/accounts/v1'] = () => reply({}, 500);
      await act(async () => { result = await view.result.current.update('v1', { name: 'x' }); });
      expect(result.message).toBe('The server refused the change (HTTP 500).');
    });

    it('shows the wait on a 429', async () => {
      routes['POST /server/accounts/v1/sign-out'] = () => reply({ detail: 'Too many' }, 429, { 'Retry-After': '17' });
      const view = await renderAccounts();
      let result;
      await act(async () => { result = await view.result.current.signOut('v1'); });
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Too many attempts. Try again in 17 seconds.');
    });

    it('reports a network error', async () => {
      routes['POST /server/accounts/v1/sign-out'] = () => { throw new TypeError('offline'); };
      const view = await renderAccounts();
      let result;
      await act(async () => { result = await view.result.current.signOut('v1'); });
      expect(result).toEqual({ ok: false, status: 0, code: null, message: 'Could not reach the server.' });
      expect(view.result.current.accounts).toEqual(LIST.accounts);
    });
  });

  it('ignores a slow older answer that arrives after a newer one', async () => {
    const answers = [];
    routes['PATCH /server/accounts/v1'] = () => new Promise((resolve) => { answers.push(resolve); });
    const view = await renderAccounts();
    const listWith = (name) => ({ ...LIST, accounts: [LIST.accounts[0], { ...LIST.accounts[1], name }] });
    let first;
    let second;
    act(() => {
      first = view.result.current.update('v1', { name: 'first' });
      second = view.result.current.update('v1', { name: 'second' });
    });
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => { answers[1](reply(listWith('second'))); await second; });
    expect(view.result.current.accounts[1].name).toBe('second');
    await act(async () => { answers[0](reply(listWith('first'))); await first; });
    expect(view.result.current.accounts[1].name).toBe('second');
  });
});

describe('useAccounts by mode', () => {
  let routes;
  let fetchMock;

  const calls = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderAccounts = async (mode) => {
    const view = renderHook(() => useAccounts(mode ? { mode } : undefined));
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    return view;
  };

  beforeEach(() => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('desktop', () => {
    const DESKTOP_LIST = { ...LIST, you: null, confirm_remembered_s: 0 };

    beforeEach(() => {
      routes['GET /sharing/accounts'] = () => reply(DESKTOP_LIST);
    });

    it('is the default mode of the session (the desktop) and loads /sharing/accounts', async () => {
      const view = await renderAccounts();
      expect(calls('GET /sharing/accounts')).toHaveLength(1);
      expect(view.result.current.accounts).toEqual(LIST.accounts);
      expect(view.result.current.you).toBeNull();
    });

    it('adds with POST and sends no current_password', async () => {
      routes['POST /sharing/accounts'] = () => reply(DESKTOP_LIST);
      const view = await renderAccounts('desktop');
      const permissions = { originals: false, image_search: true, places: false };
      await act(async () => {
        await view.result.current.add({ name: 'carol', role: 'viewer', password: 'pw-12345', permissions, currentPassword: 'ignored' });
      });
      expect(calls('POST /sharing/accounts')[0].body).toEqual({ name: 'carol', role: 'viewer', password: 'pw-12345', permissions });
    });

    it('updates with POST (not PATCH) and never sends a password', async () => {
      routes['POST /sharing/accounts/v%2F1'] = () => reply(DESKTOP_LIST);
      const view = await renderAccounts('desktop');
      await act(async () => { await view.result.current.update('v/1', { name: 'robert' }, 'ignored'); });
      expect(calls('POST /sharing/accounts/v%2F1')[0].body).toEqual({ name: 'robert' });
    });

    it('sets a password, signs out and deletes without any password', async () => {
      routes['POST /sharing/accounts/v1/password'] = () => reply(DESKTOP_LIST);
      routes['POST /sharing/accounts/v1/sign-out'] = () => reply(DESKTOP_LIST);
      routes['POST /sharing/accounts/v1/delete'] = () => reply({ ...DESKTOP_LIST, accounts: [LIST.accounts[0]] });
      const view = await renderAccounts('desktop');
      await act(async () => { await view.result.current.setPassword('v1', 'new-pass-1', 'ignored'); });
      expect(calls('POST /sharing/accounts/v1/password')[0].body).toEqual({ new_password: 'new-pass-1' });
      await act(async () => { await view.result.current.signOut('v1'); });
      expect(calls('POST /sharing/accounts/v1/sign-out')[0].init).toEqual({ method: 'POST' });
      await act(async () => { await view.result.current.remove('v1', 'ignored'); });
      expect(calls('POST /sharing/accounts/v1/delete')[0].init).toEqual({ method: 'POST' });
      expect(view.result.current.accounts).toHaveLength(1);
    });

    it('has no request body with a current_password anywhere', async () => {
      routes['POST /sharing/accounts'] = () => reply(DESKTOP_LIST);
      routes['POST /sharing/accounts/a1'] = () => reply(DESKTOP_LIST);
      routes['POST /sharing/accounts/a1/password'] = () => reply(DESKTOP_LIST);
      const view = await renderAccounts('desktop');
      await act(async () => {
        await view.result.current.add({ name: 'x', role: 'owner', password: 'pw-12345', currentPassword: 'p' });
        await view.result.current.update('a1', { disabled: true }, 'p');
        await view.result.current.setPassword('a1', 'pw-12345', 'p');
      });
      const bodies = fetchMock.mock.calls.map(([, init]) => init?.body ?? '');
      expect(bodies.some((body) => body.includes('current_password'))).toBe(false);
    });

    it('never counts a password as remembered', async () => {
      const view = await renderAccounts('desktop');
      expect(view.result.current.isConfirmRemembered()).toBe(false);
    });
  });

  describe('network', () => {
    beforeEach(() => {
      routes['GET /server/accounts'] = () => reply(LIST);
    });

    it('remembers a password for as long as the answer says, counted from now', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      routes['GET /server/accounts'] = () => reply({ ...LIST, confirm_remembered_s: 300, limits: { ...LIST.limits, confirm_remember_s: 300 } });
      const view = await renderAccounts('network');
      expect(view.result.current.isConfirmRemembered()).toBe(true);
      vi.setSystemTime(new Date('2026-01-01T00:04:59Z'));
      expect(view.result.current.isConfirmRemembered()).toBe(true);
      vi.setSystemTime(new Date('2026-01-01T00:05:01Z'));
      expect(view.result.current.isConfirmRemembered()).toBe(false);
    });

    it('remembers nothing when the answer carries no memory or zero seconds', async () => {
      const view = await renderAccounts('network');
      expect(view.result.current.isConfirmRemembered()).toBe(false);
      routes['PATCH /server/accounts/v1'] = () => reply({ ...LIST, confirm_remembered_s: 0 });
      await act(async () => { await view.result.current.update('v1', { name: 'x' }); });
      expect(view.result.current.isConfirmRemembered()).toBe(false);
    });

    it('takes a new memory from the answer to a change, and forgets it on request', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply({ ...LIST, confirm_remembered_s: 120 });
      const view = await renderAccounts('network');
      await act(async () => { await view.result.current.update('v1', { name: 'x' }, 'mine'); });
      expect(view.result.current.isConfirmRemembered()).toBe(true);
      act(() => view.result.current.forgetConfirm());
      expect(view.result.current.isConfirmRemembered()).toBe(false);
    });

    it('forgets the memory after a wrong or missing password', async () => {
      routes['GET /server/accounts'] = () => reply({ ...LIST, confirm_remembered_s: 300 });
      routes['POST /server/accounts/v1/delete'] = () => reply({ detail: 'x', code: 'confirm_password' }, 403);
      routes['PATCH /server/accounts/v1'] = () => reply({ detail: 'x', code: 'wrong_password' }, 403);
      const view = await renderAccounts('network');
      expect(view.result.current.isConfirmRemembered()).toBe(true);
      await act(async () => { await view.result.current.remove('v1'); });
      expect(view.result.current.isConfirmRemembered()).toBe(false);

      await act(async () => { await view.result.current.reload(); });
      expect(view.result.current.isConfirmRemembered()).toBe(true);
      await act(async () => { await view.result.current.update('v1', { name: 'x' }, 'bad'); });
      expect(view.result.current.isConfirmRemembered()).toBe(false);
    });

    it('sends a delete without a password as an empty body', async () => {
      routes['POST /server/accounts/v1/delete'] = () => reply(LIST);
      const view = await renderAccounts('network');
      await act(async () => { await view.result.current.remove('v1'); });
      expect(calls('POST /server/accounts/v1/delete')[0].body).toEqual({});
    });
  });
});
