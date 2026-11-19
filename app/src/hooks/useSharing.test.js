import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { problemText, useSharing } from './useSharing';

const VIEW = {
  enabled: false,
  running: false,
  problems: [{ code: 'no_accounts', message: 'Add an account first, so someone can sign in.' }],
  host: '0.0.0.0',
  port: 8080,
  tls_mode: 'off',
  cert_file: '',
  key_file: '',
  library_roots: [],
  allowed_hosts: [],
  public_access: false,
  from_environment: [],
  urls: [],
  fingerprint: '',
  fingerprint_may_change: false,
  web_ui: true,
  accounts: { owners: 0, viewers: 0, can_sign_in: 0 },
  config_problems: [],
};

const RUNNING = { ...VIEW, enabled: true, running: true, problems: [], urls: ['http://192.168.1.5:8080/'] };

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('useSharing', () => {
  let routes;
  let fetchMock;

  const calls = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderSharing = async () => {
    const view = renderHook(() => useSharing());
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    return view;
  };

  beforeEach(() => {
    routes = { 'GET /sharing': () => reply(VIEW) };
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

  describe('loading', () => {
    it('is loading with no state, then holds the view', async () => {
      const view = renderHook(() => useSharing());
      expect(view.result.current.isLoading).toBe(true);
      expect(view.result.current.state).toBeNull();
      expect(view.result.current.isBusy).toBe(false);
      await waitFor(() => expect(view.result.current.isLoading).toBe(false));
      expect(view.result.current.state).toEqual(VIEW);
      expect(view.result.current.loadFailed).toBe(false);
    });

    it('reports a failed load, and loads again on reload', async () => {
      routes['GET /sharing'] = () => reply({ detail: 'x' }, 500);
      const view = await renderSharing();
      expect(view.result.current.loadFailed).toBe(true);
      expect(view.result.current.state).toBeNull();
      routes['GET /sharing'] = () => reply(VIEW);
      await act(() => view.result.current.reload());
      expect(view.result.current.loadFailed).toBe(false);
      expect(view.result.current.state).toEqual(VIEW);
    });

    it('never polls: no second GET however much time passes', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
      const view = renderHook(() => useSharing());
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(view.result.current.isLoading).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
      expect(calls('GET /sharing')).toHaveLength(1);
    });
  });

  describe('apply', () => {
    it('posts the changes and takes the new view', async () => {
      routes['POST /sharing'] = () => reply(RUNNING);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.apply({ enabled: true }); });
      expect(result).toEqual({ ok: true });
      const [call] = calls('POST /sharing');
      expect(call.body).toEqual({ enabled: true });
      expect(call.init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(view.result.current.state).toEqual(RUNNING);
    });

    it('is busy while a request runs', async () => {
      let finish;
      routes['POST /sharing'] = () => new Promise((resolve) => { finish = () => resolve(reply(RUNNING)); });
      const view = await renderSharing();
      let pending;
      act(() => { pending = view.result.current.apply({ enabled: true }); });
      await waitFor(() => expect(view.result.current.isBusy).toBe(true));
      await act(async () => { finish(); await pending; });
      expect(view.result.current.isBusy).toBe(false);
    });

    it('start_failed returns the problems, translated, and takes the state from "sharing"', async () => {
      const problems = [{ code: 'port_in_use', message: 'Port 8080 is in use' }];
      routes['POST /sharing'] = () => reply({
        detail: 'Port 8080 is in use',
        code: 'start_failed',
        problems,
        saved: false,
        sharing: { ...VIEW, port: 8080, problems },
      }, 409);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.apply({ enabled: true }); });
      expect(result).toEqual({
        ok: false,
        status: 409,
        code: 'start_failed',
        message: 'The port is already in use by another program. Choose another port.',
        problems,
        saved: false,
      });
      expect(view.result.current.state.problems).toEqual(problems);
      expect(view.result.current.state.enabled).toBe(false);
    });

    it('start_failed falls back to the backend message for an unknown problem code', async () => {
      const problems = [{ code: 'brand_new', message: 'Something odd' }];
      routes['POST /sharing'] = () => reply({ detail: 'Something odd', code: 'start_failed', problems, saved: true, sharing: VIEW }, 409);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.apply({ port: 9000 }); });
      expect(result.message).toBe('Something odd');
      expect(result.saved).toBe(true);
    });

    it('stopped_not_saved updates the state and says so', async () => {
      const stopped = { ...VIEW, enabled: true, running: false, problems: [] };
      routes['GET /sharing'] = () => reply(RUNNING);
      routes['POST /sharing'] = () => reply({ detail: 'x', code: 'stopped_not_saved', sharing: stopped }, 409);
      const view = await renderSharing();
      expect(view.result.current.state.running).toBe(true);
      let result;
      await act(async () => { result = await view.result.current.apply({ enabled: false }); });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('stopped_not_saved');
      expect(result.message).toBe("Sharing stopped, but the setting couldn't be saved, so it starts again with the app.");
      expect(view.result.current.state).toEqual(stopped);
    });

    it('invalid_setting shows the backend reason after a translated lead', async () => {
      routes['POST /sharing'] = () => reply({ detail: 'The port must be 1024 or more', code: 'invalid_setting', problems: ['The port must be 1024 or more'] }, 400);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.apply({ port: 80 }); });
      expect(result.message).toBe("That setting isn't valid: The port must be 1024 or more");
      expect(result.problems).toEqual([]);
      expect(view.result.current.state).toEqual(VIEW);
    });

    it('from_environment and an unreachable backend keep the state and give a sentence', async () => {
      routes['POST /sharing'] = () => reply({ detail: 'x', code: 'from_environment', fields: ['port'] }, 409);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.apply({ port: 9000 }); });
      expect(result.code).toBe('from_environment');
      expect(result.message).toBe("This setting is set by an environment variable, so it can't be changed here.");
      routes['POST /sharing'] = () => { throw new TypeError('offline'); };
      await act(async () => { result = await view.result.current.apply({ port: 9000 }); });
      expect(result).toEqual({ ok: false, status: 0, code: null, message: 'Could not reach the server.', problems: [] });
      expect(view.result.current.state).toEqual(VIEW);
    });

    it('ignores a slow older answer that arrives after a newer one', async () => {
      const answers = [];
      routes['POST /sharing'] = () => new Promise((resolve) => { answers.push(resolve); });
      const view = await renderSharing();
      let first;
      let second;
      act(() => {
        first = view.result.current.apply({ port: 9001 });
        second = view.result.current.apply({ port: 9002 });
      });
      await waitFor(() => expect(answers).toHaveLength(2));
      await act(async () => { answers[1](reply({ ...VIEW, port: 9002 })); await second; });
      expect(view.result.current.state.port).toBe(9002);
      await act(async () => { answers[0](reply({ ...VIEW, port: 9001 })); await first; });
      expect(view.result.current.state.port).toBe(9002);
    });

    it('ignores a slow first load that arrives after a change', async () => {
      let finishLoad;
      routes['GET /sharing'] = () => new Promise((resolve) => { finishLoad = () => resolve(reply(VIEW)); });
      routes['POST /sharing'] = () => reply(RUNNING);
      const view = renderHook(() => useSharing());
      await waitFor(() => expect(typeof finishLoad).toBe('function'));
      await act(async () => { await view.result.current.apply({ enabled: true }); });
      expect(view.result.current.state.running).toBe(true);
      await act(async () => { finishLoad(); });
      await waitFor(() => expect(view.result.current.isLoading).toBe(false));
      expect(view.result.current.state.running).toBe(true);
    });
  });

  describe('signOutEverywhere', () => {
    it('posts with no body and resolves to ok', async () => {
      routes['POST /sharing/sign-out-everywhere'] = () => reply({ status: 'success' });
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.signOutEverywhere(); });
      expect(result).toEqual({ ok: true });
      expect(calls('POST /sharing/sign-out-everywhere')[0].init).toEqual({ method: 'POST' });
    });

    it('resolves to a message on a refusal', async () => {
      routes['POST /sharing/sign-out-everywhere'] = () => reply({ detail: 'x', code: 'config_unreadable' }, 409);
      const view = await renderSharing();
      let result;
      await act(async () => { result = await view.result.current.signOutEverywhere(); });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("The server's settings file could not be read, so nothing was changed.");
    });
  });

  describe('problemText', () => {
    it('translates a known code and falls back to the message', () => {
      expect(problemText({ code: 'tls_invalid', message: 'bad pem' })).toBe("The certificate file or the key file isn't valid.");
      expect(problemText({ code: 'brand_new', message: 'English text' })).toBe('English text');
    });
  });
});
