import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from '../../i18n';
import { resetEscapeKeyForTests } from '../../hooks/useEscapeKey';
import { HttpSharingWarningModal } from './HttpSharingWarningModal';
import { SharingIntroModal } from './SharingIntroModal';
import { SharingSection } from './SharingSection';
import { resetSharingPromptsForTests } from './sharingPrompts';

const VIEW = {
  enabled: false,
  running: false,
  problems: [],
  host: '0.0.0.0',
  port: 8080,
  tls_mode: 'off',
  cert_file: '',
  key_file: '',
  library_roots: ['D:\\Photos', 'E:\\Video'],
  allowed_hosts: [],
  public_access: false,
  from_environment: [],
  urls: [],
  fingerprint: '',
  fingerprint_may_change: false,
  web_ui: true,
  accounts: { owners: 1, viewers: 2, can_sign_in: 3 },
  config_problems: [],
};

const RUNNING = { ...VIEW, enabled: true, running: true, urls: ['http://192.168.1.5:8080/', 'http://10.0.0.7:8080/'] };

const ACCOUNTS = {
  accounts: [{ id: 'a1', name: 'alice', role: 'owner', permissions: { originals: true, image_search: true, places: true }, disabled: false }],
  you: null,
  confirm_remembered_s: 0,
  limits: { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256, confirm_remember_s: 0 },
};

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('SharingSection', () => {
  let routes;
  let fetchMock;
  let setToast;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderSection = async (view = VIEW, uiTheme = 'modern') => {
    routes['GET /sharing'] = () => reply(view);
    render(<SharingSection uiTheme={uiTheme} setToast={setToast} />);
    await screen.findByRole('switch', { name: 'Share on my network' });
  };

  const theSwitch = () => screen.getByRole('switch', { name: 'Share on my network' });

  beforeEach(() => {
    // The two pop-ups have their own describe blocks; everywhere else they are switched off, as for a person who
    // has seen them and ticked "Don't warn me again".
    localStorage.clear();
    localStorage.setItem('sharing_intro_seen', 'true');
    localStorage.setItem('sharing_http_warning_off', 'true');
    resetSharingPromptsForTests();
    setToast = vi.fn();
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
    resetEscapeKeyForTests();
    delete window.electronAPI;
    vi.unstubAllGlobals();
  });

  describe('loading', () => {
    it('shows a loading line, then the section; it reads the state once', async () => {
      routes['GET /sharing'] = () => reply(VIEW);
      render(<SharingSection uiTheme="modern" setToast={setToast} />);
      expect(screen.getByRole('status').textContent).toBe('Loading sharing settings...');
      await screen.findByRole('switch', { name: 'Share on my network' });
      expect(screen.getByRole('heading', { name: 'Network sharing' })).toBeTruthy();
      expect(requests('GET /sharing')).toHaveLength(1);
    });

    it('has no title of its own when the page it sits on carries it, while loading and after', async () => {
      routes['GET /sharing'] = () => reply(VIEW);
      render(<SharingSection uiTheme="modern" setToast={setToast} showTitle={false} />);
      expect(screen.getByRole('status').textContent).toBe('Loading sharing settings...');
      expect(screen.queryByRole('heading', { name: 'Network sharing' })).toBeNull();
      await screen.findByRole('switch', { name: 'Share on my network' });
      expect(screen.queryByRole('heading', { name: 'Network sharing' })).toBeNull();
    });

    it('says so when the state cannot be loaded and retries', async () => {
      routes['GET /sharing'] = () => reply({ detail: 'x' }, 500);
      render(<SharingSection uiTheme="modern" setToast={setToast} />);
      expect((await screen.findByRole('alert')).textContent).toBe('Could not load the sharing settings.');
      routes['GET /sharing'] = () => reply(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByRole('switch', { name: 'Share on my network' });
    });
  });

  describe('the states', () => {
    it('stopped with no_accounts: off, the problem in words, a warning, no addresses', async () => {
      await renderSection({
        ...VIEW,
        problems: [{ code: 'no_accounts', message: 'Add an account first, so someone can sign in.' }],
        accounts: { owners: 0, viewers: 0, can_sign_in: 0 },
      });
      expect(theSwitch().getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Sharing is off.')).toBeTruthy();
      expect(screen.getByText('No account can sign in yet. Add one first.')).toBeTruthy();
      expect(screen.getByText('No account can sign in yet: add one before sharing.')).toBeTruthy();
      expect(screen.getByText('0 owners, 0 viewers')).toBeTruthy();
      expect(screen.queryByText('Addresses to open')).toBeNull();
    });

    it('running: on, with each address and a copy button, and the account counts', async () => {
      await renderSection(RUNNING);
      expect(theSwitch().getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('Sharing is on. Other devices on the network can open the addresses below.')).toBeTruthy();
      expect(screen.getByText('http://192.168.1.5:8080/')).toBeTruthy();
      expect(screen.getByText('http://10.0.0.7:8080/')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Copy http://192.168.1.5:8080/' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Copy http://10.0.0.7:8080/' })).toBeTruthy();
      expect(screen.getByText('1 owner, 2 viewers')).toBeTruthy();
      expect(screen.queryByText('No account can sign in yet: add one before sharing.')).toBeNull();
    });

    it('should run but cannot: amber, with the problem translated by its code', async () => {
      await renderSection({
        ...VIEW,
        enabled: true,
        problems: [{ code: 'port_in_use', message: 'Port 8080 is already in use.' }],
      });
      expect(theSwitch().getAttribute('aria-checked')).toBe('true');
      const status = screen.getByText("Sharing should be on, but it isn't running.");
      expect(status.className).toContain('amber');
      const problem = screen.getByText('The port is already in use by another program. Choose another port.');
      expect(problem.closest('ul').className).toContain('amber');
    });

    it('falls back to the backend message for a problem it has no text for', async () => {
      await renderSection({ ...VIEW, enabled: true, problems: [{ code: 'brand_new', message: 'Something odd' }] });
      expect(screen.getByText('Something odd')).toBeTruthy();
    });

    it('locks the fields an environment variable sets, and says which', async () => {
      await renderSection({ ...VIEW, tls_mode: 'files', cert_file: 'C:\\c.pem', key_file: 'C:\\k.pem', from_environment: ['port', 'tls_mode', 'cert_file', 'key_file', 'library_roots'] });
      expect(screen.getByText("Set by environment variables, so they can't be changed here: port, tls_mode, cert_file, key_file, library_roots")).toBeTruthy();
      expect(screen.getByLabelText('Port').disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Off' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Self-signed' }).disabled).toBe(true);
      expect(screen.getByLabelText('Certificate file').disabled).toBe(true);
      expect(screen.getByLabelText('Key file').disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Remove D:\\Photos' }).disabled).toBe(true);
      expect(screen.getByLabelText('Folder path').disabled).toBe(true);
      // Unlocked parts stay usable.
      expect(theSwitch().disabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Manage accounts' }).disabled).toBe(false);
    });

    it('notes that the web interface is not installed only when it is not', async () => {
      await renderSection({ ...VIEW, web_ui: false });
      expect(screen.getByText("The web interface isn't installed in this build.")).toBeTruthy();
      cleanup();
      await renderSection({ ...VIEW, web_ui: true });
      expect(screen.queryByText("The web interface isn't installed in this build.")).toBeNull();
    });

    it('shows the notes: how long sharing lasts, the firewall and, on plain HTTP, the encryption', async () => {
      await renderSection(VIEW);
      expect(screen.getByText('Sharing lasts only while VBLIS is open.')).toBeTruthy();
      expect(screen.getByText('Windows may ask to allow VBLIS through the firewall. Allow it on private networks.')).toBeTruthy();
      expect(screen.getByText("Without HTTPS, pictures and signed-in sessions travel unencrypted. Use HTTPS on any network you don't fully trust.")).toBeTruthy();
      cleanup();
      await renderSection({ ...VIEW, tls_mode: 'self_signed' });
      expect(screen.queryByText(/travel unencrypted/)).toBeNull();
    });

    it('renders in the terminal style too', async () => {
      await renderSection(RUNNING, 'terminal');
      expect(theSwitch().getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('the switch', () => {
    it('sends enabled: true, then shows the running state and toasts', async () => {
      routes['POST /sharing'] = () => reply(RUNNING);
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
      expect(requests('POST /sharing')[0].body).toEqual({ enabled: true });
      expect(screen.getByText('http://192.168.1.5:8080/')).toBeTruthy();
      expect(setToast).toHaveBeenCalledWith({ message: 'Sharing is on.', type: 'success' });
    });

    it('sends enabled: false', async () => {
      routes['POST /sharing'] = () => reply(VIEW);
      await renderSection(RUNNING);
      fireEvent.click(theSwitch());
      await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'));
      expect(requests('POST /sharing')[0].body).toEqual({ enabled: false });
      expect(screen.queryByText('Addresses to open')).toBeNull();
    });

    it('shows why sharing could not start, and leaves the switch off', async () => {
      const problems = [{ code: 'port_in_use', message: 'in use' }];
      routes['POST /sharing'] = () => reply({ detail: 'in use', code: 'start_failed', problems, saved: false, sharing: { ...VIEW, problems } }, 409);
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('The port is already in use by another program. Choose another port.');
      expect(theSwitch().getAttribute('aria-checked')).toBe('false');
      expect(setToast).not.toHaveBeenCalled();
    });

    it('warns when sharing stopped but the setting was not saved', async () => {
      routes['POST /sharing'] = () => reply({ detail: 'x', code: 'stopped_not_saved', sharing: { ...VIEW, enabled: true } }, 409);
      await renderSection(RUNNING);
      fireEvent.click(theSwitch());
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe("Sharing stopped, but the setting couldn't be saved, so it starts again with the app.");
      expect(alert.className).toContain('amber');
      expect(screen.getByText("Sharing should be on, but it isn't running.")).toBeTruthy();
    });

    it('disables every action while a request runs', async () => {
      let finish;
      routes['POST /sharing'] = () => new Promise((resolve) => { finish = () => resolve(reply(RUNNING)); });
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      await waitFor(() => expect(theSwitch().disabled).toBe(true));
      expect(screen.getByRole('button', { name: 'Self-signed' }).disabled).toBe(true);
      expect(screen.getByLabelText('Port').disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Add folder' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Remove D:\\Photos' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Manage accounts' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Sign out every browser' }).disabled).toBe(true);
      finish();
      await waitFor(() => expect(theSwitch().disabled).toBe(false));
    });
  });

  describe('the addresses', () => {
    it('copies an address through the Electron bridge and toasts', async () => {
      const copyText = vi.fn().mockResolvedValue({ success: true });
      window.electronAPI = { copyText };
      await renderSection(RUNNING);
      fireEvent.click(screen.getByRole('button', { name: 'Copy http://10.0.0.7:8080/' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Copied.', type: 'success' }));
      expect(copyText).toHaveBeenCalledWith('http://10.0.0.7:8080/');
    });

    it('keeps the address selectable and reports a copy that failed', async () => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: false, error: 'Nothing to copy.' }) };
      await renderSection(RUNNING);
      expect(screen.getByText('http://192.168.1.5:8080/').className).toContain('select-all');
      fireEvent.click(screen.getByRole('button', { name: 'Copy http://192.168.1.5:8080/' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Nothing to copy.', type: 'error' }));
    });
  });

  describe('HTTPS', () => {
    it('shows the current choice as pressed', async () => {
      await renderSection({ ...VIEW, tls_mode: 'self_signed' });
      expect(screen.getByRole('button', { name: 'Self-signed' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByRole('button', { name: 'Own files' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('applies self-signed and off at once', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, tls_mode: 'self_signed' });
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Self-signed' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Self-signed' }).getAttribute('aria-pressed')).toBe('true'));
      expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'self_signed' });

      routes['POST /sharing'] = () => reply(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Off' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(2));
      expect(requests('POST /sharing')[1].body).toEqual({ tls_mode: 'off' });
    });

    it('own files: sends the mode and both paths after the Choose buttons filled them', async () => {
      const openFile = vi.fn(async (kind) => (kind === 'certificate' ? 'C:\\certs\\site.pem' : 'C:\\certs\\site.key'));
      window.electronAPI = { openFile };
      routes['POST /sharing'] = () => reply({ ...VIEW, tls_mode: 'files', cert_file: 'C:\\certs\\site.pem', key_file: 'C:\\certs\\site.key' });
      await renderSection(VIEW);
      expect(screen.queryByLabelText('Certificate file')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Own files' }));
      expect(requests('POST /sharing')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Use these files' }).disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Choose certificate...' }));
      await waitFor(() => expect(screen.getByLabelText('Certificate file').value).toBe('C:\\certs\\site.pem'));
      fireEvent.click(screen.getByRole('button', { name: 'Choose key...' }));
      await waitFor(() => expect(screen.getByLabelText('Key file').value).toBe('C:\\certs\\site.key'));
      expect(openFile.mock.calls).toEqual([['certificate'], ['key']]);

      fireEvent.click(screen.getByRole('button', { name: 'Use these files' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'files', cert_file: 'C:\\certs\\site.pem', key_file: 'C:\\certs\\site.key' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Own files' }).getAttribute('aria-pressed')).toBe('true'));
    });

    it('own files without Electron: text fields only, and Save sends what was typed', async () => {
      routes['POST /sharing'] = () => reply(VIEW);
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Own files' }));
      expect(screen.queryByRole('button', { name: 'Choose certificate...' })).toBeNull();
      fireEvent.change(screen.getByLabelText('Certificate file'), { target: { value: '/etc/ssl/site.pem' } });
      fireEvent.change(screen.getByLabelText('Key file'), { target: { value: '/etc/ssl/site.key' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use these files' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'files', cert_file: '/etc/ssl/site.pem', key_file: '/etc/ssl/site.key' });
    });

    it('keeps a cancelled Choose dialog from changing the field', async () => {
      window.electronAPI = { openFile: vi.fn().mockResolvedValue(null) };
      await renderSection({ ...VIEW, tls_mode: 'files', cert_file: 'C:\\c.pem', key_file: 'C:\\k.pem' });
      fireEvent.click(screen.getByRole('button', { name: 'Choose certificate...' }));
      await waitFor(() => expect(window.electronAPI.openFile).toHaveBeenCalled());
      expect(screen.getByLabelText('Certificate file').value).toBe('C:\\c.pem');
    });

    it('shows the failure of the files in the section', async () => {
      const problems = [{ code: 'tls_file_missing', message: 'The certificate file doesn\'t exist' }];
      routes['POST /sharing'] = () => reply({ detail: 'x', code: 'start_failed', problems, saved: true, sharing: VIEW }, 409);
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Own files' }));
      fireEvent.change(screen.getByLabelText('Certificate file'), { target: { value: 'nope.pem' } });
      fireEvent.change(screen.getByLabelText('Key file'), { target: { value: 'nope.key' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use these files' }));
      expect((await screen.findByRole('alert')).textContent)
        .toBe('HTTPS with your own files needs a certificate file and a key file, and both must exist.');
    });

    it('shows the fingerprint with a copy button, and a note when it may change', async () => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: true }) };
      await renderSection({ ...VIEW, tls_mode: 'self_signed', fingerprint: 'AA:BB:CC', fingerprint_may_change: true });
      expect(screen.getByText('AA:BB:CC')).toBeTruthy();
      expect(screen.getByText('The fingerprint may change the next time sharing starts.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Copy fingerprint' }));
      await waitFor(() => expect(window.electronAPI.copyText).toHaveBeenCalledWith('AA:BB:CC'));
    });

    it('shows no fingerprint or note when there is none', async () => {
      await renderSection(VIEW);
      expect(screen.queryByText('Certificate fingerprint')).toBeNull();
      expect(screen.queryByText(/may change the next time/)).toBeNull();
    });
  });

  describe('the port', () => {
    it('sends the new port with Save, and only when it changed', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, port: 9090 });
      await renderSection(VIEW);
      const save = screen.getByRole('button', { name: 'Save port' });
      expect(save.disabled).toBe(true);
      expect(screen.getByLabelText('Port').value).toBe('8080');
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '9090' } });
      expect(save.disabled).toBe(false);
      fireEvent.click(save);
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ port: 9090 });
      await waitFor(() => expect(screen.getByLabelText('Port').value).toBe('9090'));
      expect(screen.getByRole('button', { name: 'Save port' }).disabled).toBe(true);
    });

    it('does not send an invalid port', async () => {
      await renderSection(VIEW);
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '70000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save port' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Enter a port from 1 to 65535.');
      expect(requests('POST /sharing')).toHaveLength(0);
    });

    it('shows a refusal of the port with the backend reason', async () => {
      routes['POST /sharing'] = () => reply({ detail: 'The port must be 1024 or more', code: 'invalid_setting', problems: [] }, 400);
      await renderSection(VIEW);
      fireEvent.change(screen.getByLabelText('Port'), { target: { value: '80' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save port' }));
      expect((await screen.findByRole('alert')).textContent).toBe("That setting isn't valid: The port must be 1024 or more");
      expect(screen.getByLabelText('Port').value).toBe('80');
    });
  });

  describe('the library folders', () => {
    it('lists them, and explains where browsers can add folders', async () => {
      await renderSection(VIEW);
      expect(screen.getByText('D:\\Photos')).toBeTruthy();
      expect(screen.getByText('E:\\Video')).toBeTruthy();
      expect(screen.getByText('Folders added from a browser must be inside one of these.')).toBeTruthy();
    });

    it('says so when there are none', async () => {
      await renderSection({ ...VIEW, library_roots: [] });
      expect(screen.getByText('No folders yet.')).toBeTruthy();
    });

    it('removes one by sending the whole new list', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, library_roots: ['E:\\Video'] });
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Remove D:\\Photos' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ library_roots: ['E:\\Video'] });
      await waitFor(() => expect(screen.queryByText('D:\\Photos')).toBeNull());
    });

    it('adds the folders the dialog returns to the whole list, without repeating one', async () => {
      const openDirectory = vi.fn().mockResolvedValue(['F:\\New', 'D:\\Photos']);
      window.electronAPI = { openDirectory };
      routes['POST /sharing'] = () => reply({ ...VIEW, library_roots: ['D:\\Photos', 'E:\\Video', 'F:\\New'] });
      await renderSection(VIEW);
      expect(screen.queryByLabelText('Folder path')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ library_roots: ['D:\\Photos', 'E:\\Video', 'F:\\New'] });
      await screen.findByText('F:\\New');
    });

    it('sends nothing when the dialog is cancelled', async () => {
      window.electronAPI = { openDirectory: vi.fn().mockResolvedValue(null) };
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
      await waitFor(() => expect(window.electronAPI.openDirectory).toHaveBeenCalled());
      expect(requests('POST /sharing')).toHaveLength(0);
    });

    it('without Electron: a text field and an Add button that sends the whole list', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, library_roots: ['D:\\Photos', 'E:\\Video', '/srv/more'] });
      await renderSection(VIEW);
      const add = screen.getByRole('button', { name: 'Add folder' });
      expect(add.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '  /srv/more  ' } });
      expect(add.disabled).toBe(false);
      fireEvent.click(add);
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ library_roots: ['D:\\Photos', 'E:\\Video', '/srv/more'] });
      await waitFor(() => expect(screen.getByLabelText('Folder path').value).toBe(''));
    });

    it('keeps the typed path when the backend refuses it', async () => {
      routes['POST /sharing'] = () => reply({ detail: "The folder doesn't exist", code: 'invalid_setting', problems: [] }, 400);
      await renderSection(VIEW);
      fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'Z:\\gone' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
      expect((await screen.findByRole('alert')).textContent).toBe("That setting isn't valid: The folder doesn't exist");
      expect(screen.getByLabelText('Folder path').value).toBe('Z:\\gone');
    });
  });

  describe('the other local networks', () => {
    const NETWORKS = ['199.255.218.213', '203.0.113.0/24'];
    const NONE_TEXT = 'None. Home and office networks, VPNs such as Tailscale, and this PC always count as local.';
    const field = () => screen.getByLabelText('Address or range');
    const addButton = () => screen.getByRole('button', { name: 'Add' });

    it('lists the entries, with a Remove button for each, and the hint', async () => {
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      expect(screen.getByRole('heading', { name: 'Other local networks' })).toBeTruthy();
      expect(screen.getByText('199.255.218.213').className).toContain('font-mono');
      expect(screen.getByText('203.0.113.0/24')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove 199.255.218.213' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove 203.0.113.0/24' })).toBeTruthy();
      expect(screen.queryByText(NONE_TEXT)).toBeNull();
      expect(screen.getByText(/Devices with these addresses can open VBLIS/)).toBeTruthy();
      expect(field().id).toBe('sharing-local-network');
    });

    it('says so when the list is empty, or missing from the answer', async () => {
      await renderSection({ ...VIEW, local_networks: [] });
      expect(screen.getByText(NONE_TEXT)).toBeTruthy();
      cleanup();
      await renderSection(VIEW);
      expect(screen.getByText(NONE_TEXT)).toBeTruthy();
      expect(field()).toBeTruthy();
    });

    it('adds one by sending the whole list with the trimmed address, then clears the field', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, local_networks: [...NETWORKS, '198.51.100.7'] });
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      fireEvent.change(field(), { target: { value: '  198.51.100.7  ' } });
      fireEvent.click(addButton());
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ local_networks: [...NETWORKS, '198.51.100.7'] });
      await waitFor(() => expect(field().value).toBe(''));
      expect(await screen.findByText('198.51.100.7')).toBeTruthy();
      expect(setToast).toHaveBeenCalledWith({ message: 'Saved.', type: 'success' });
    });

    it('sends nothing for an entry that is already there, and clears the field', async () => {
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      fireEvent.change(field(), { target: { value: ' 203.0.113.0/24 ' } });
      fireEvent.click(addButton());
      await waitFor(() => expect(field().value).toBe(''));
      expect(requests('POST /sharing')).toHaveLength(0);
    });

    it('keeps Add disabled while the field is empty or only spaces', async () => {
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      expect(addButton().disabled).toBe(true);
      fireEvent.change(field(), { target: { value: '   ' } });
      expect(addButton().disabled).toBe(true);
      fireEvent.change(field(), { target: { value: '10.1.1.1' } });
      expect(addButton().disabled).toBe(false);
    });

    it('removes one by sending the list without it', async () => {
      routes['POST /sharing'] = () => reply({ ...VIEW, local_networks: ['199.255.218.213'] });
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      fireEvent.click(screen.getByRole('button', { name: 'Remove 203.0.113.0/24' }));
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ local_networks: ['199.255.218.213'] });
      await waitFor(() => expect(screen.queryByText('203.0.113.0/24')).toBeNull());
    });

    it('locks the field, Add and Remove when an environment variable sets the list', async () => {
      await renderSection({ ...VIEW, local_networks: NETWORKS, from_environment: ['local_networks'] });
      expect(field().disabled).toBe(true);
      expect(addButton().disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Remove 199.255.218.213' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Remove 203.0.113.0/24' }).disabled).toBe(true);
      // Other cards stay usable.
      expect(screen.getByLabelText('Port').disabled).toBe(false);
    });

    it('shows the refusal and keeps the typed value', async () => {
      routes['POST /sharing'] = () => reply({ detail: "local_networks: '0.0.0.0/0' is too wide; use a narrower range", code: 'invalid_setting', problems: [] }, 400);
      await renderSection({ ...VIEW, local_networks: NETWORKS });
      fireEvent.change(field(), { target: { value: '0.0.0.0/0' } });
      fireEvent.click(addButton());
      expect((await screen.findByRole('alert')).textContent)
        .toBe("That setting isn't valid: local_networks: '0.0.0.0/0' is too wide; use a narrower range");
      expect(field().value).toBe('0.0.0.0/0');
      expect(setToast).not.toHaveBeenCalled();
    });
  });

  describe('accounts', () => {
    it('opens the accounts window in desktop mode, with no password field, and reads the counts again on close', async () => {
      routes['GET /sharing/accounts'] = () => reply(ACCOUNTS);
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }));
      const dialog = await screen.findByRole('dialog', { name: 'Accounts' });
      expect(await within(dialog).findByText('alice')).toBeTruthy();
      expect(requests('GET /sharing/accounts')).toHaveLength(1);
      expect(requests('GET /server/accounts')).toHaveLength(0);
      expect(within(dialog).queryByText('you')).toBeNull();

      routes['GET /sharing'] = () => reply({ ...VIEW, accounts: { owners: 2, viewers: 2, can_sign_in: 4 } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(await screen.findByText('2 owners, 2 viewers')).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Accounts' })).toBeNull();
    });
  });

  describe('sign out every browser', () => {
    it('asks first, sends nothing on Cancel', async () => {
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out every browser' }));
      expect(screen.getByText('Every browser signed in to the shared address has to sign in again.')).toBeTruthy();
      expect(requests('POST /sharing/sign-out-everywhere')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Every browser signed in to the shared address has to sign in again.')).toBeNull();
      expect(requests('POST /sharing/sign-out-everywhere')).toHaveLength(0);
    });

    it('calls the backend after the confirmation and toasts', async () => {
      routes['POST /sharing/sign-out-everywhere'] = () => reply({ status: 'success' });
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out every browser' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign out every browser' })[0]);
      await waitFor(() => expect(requests('POST /sharing/sign-out-everywhere')).toHaveLength(1));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Every browser was signed out.', type: 'success' }));
      await waitFor(() => expect(screen.queryByText('Every browser signed in to the shared address has to sign in again.')).toBeNull());
    });

    it('toasts a refusal', async () => {
      routes['POST /sharing/sign-out-everywhere'] = () => reply({ detail: 'x', code: 'config_unreadable' }, 409);
      await renderSection(VIEW);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out every browser' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign out every browser' })[0]);
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({
        message: "The server's settings file could not be read, so nothing was changed.",
        type: 'error',
      }));
    });
  });

  describe('the first-time intro', () => {
    const SELF_SIGNED = { ...VIEW, tls_mode: 'self_signed' };
    const FILES = { ...VIEW, tls_mode: 'files', cert_file: 'C:\\c.pem', key_file: 'C:\\k.pem' };
    const intro = () => screen.getByRole('dialog', { name: 'Before you share' });
    const noPopUp = () => expect(screen.queryByRole('dialog')).toBeNull();

    beforeEach(() => localStorage.clear());

    it('opens on the first switch-on and sends nothing yet', async () => {
      await renderSection(SELF_SIGNED);
      noPopUp();
      fireEvent.click(theSwitch());
      expect(intro().getAttribute('aria-modal')).toBe('true');
      expect(requests('POST /sharing')).toHaveLength(0);
    });

    it('Cancel sends nothing, leaves it unseen and asks again next time', async () => {
      await renderSection(SELF_SIGNED);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('button', { name: 'Cancel' }));
      noPopUp();
      expect(requests('POST /sharing')).toHaveLength(0);
      expect(localStorage.getItem('sharing_intro_seen')).toBeNull();
      fireEvent.click(theSwitch());
      expect(intro()).toBeTruthy();
    });

    it('Escape and a click on the backdrop count as Cancel', async () => {
      await renderSection(SELF_SIGNED);
      fireEvent.click(theSwitch());
      fireEvent.keyDown(window, { key: 'Escape' });
      noPopUp();
      fireEvent.click(theSwitch());
      fireEvent.click(intro().parentElement);
      noPopUp();
      expect(requests('POST /sharing')).toHaveLength(0);
      expect(localStorage.getItem('sharing_intro_seen')).toBeNull();
    });

    it('Turn on sharing stores that it was seen, sends enabled: true and never shows again', async () => {
      routes['POST /sharing'] = () => reply({ ...RUNNING, tls_mode: 'self_signed' });
      await renderSection(SELF_SIGNED);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('button', { name: 'Turn on sharing' }));
      noPopUp();
      await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
      expect(requests('POST /sharing')[0].body).toEqual({ enabled: true });
      expect(JSON.parse(localStorage.getItem('sharing_intro_seen'))).toBe(true);
      expect(setToast).toHaveBeenCalledWith({ message: 'Sharing is on.', type: 'success' });

      cleanup();
      await renderSection(SELF_SIGNED);
      fireEvent.click(theSwitch());
      noPopUp();
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(2));
      expect(requests('POST /sharing')[1].body).toEqual({ enabled: true });
    });

    it('does not open when the switch is turned off', async () => {
      routes['POST /sharing'] = () => reply(SELF_SIGNED);
      await renderSection({ ...RUNNING, tls_mode: 'self_signed' });
      fireEvent.click(theSwitch());
      noPopUp();
      await waitFor(() => expect(requests('POST /sharing')[0].body).toEqual({ enabled: false }));
    });

    it('with a self-signed certificate it explains the browser warning and the fingerprint', async () => {
      await renderSection(SELF_SIGNED);
      fireEvent.click(theSwitch());
      const dialog = within(intro());
      expect(dialog.getByText(/Each person signs in with an account you create here/)).toBeTruthy();
      expect(dialog.getByText('The first visit shows a warning')).toBeTruthy();
      expect(dialog.getByText('Chrome or Edge: Advanced \u2192 Continue to the site')).toBeTruthy();
      expect(dialog.getByText('Safari on iPhone or Mac: Show Details \u2192 visit this website')).toBeTruthy();
      expect(dialog.getByText('Firefox: Advanced \u2192 Accept the Risk and Continue')).toBeTruthy();
      expect(dialog.getByText(/compare the certificate fingerprint/)).toBeTruthy();
      expect(dialog.getByText(/Allow it on private networks/)).toBeTruthy();
      expect(dialog.getByText('Sharing stops when you close VBLIS.')).toBeTruthy();
      expect(dialog.queryByRole('checkbox')).toBeNull();
    });

    it('with the owner\'s own files it leaves out the warning and the fingerprint', async () => {
      await renderSection(FILES);
      fireEvent.click(theSwitch());
      const dialog = within(intro());
      expect(dialog.queryByText('The first visit shows a warning')).toBeNull();
      expect(dialog.queryByText(/compare the certificate fingerprint/)).toBeNull();
      expect(dialog.getByText(/Allow it on private networks/)).toBeTruthy();
      expect(dialog.getByText('Sharing stops when you close VBLIS.')).toBeTruthy();
      expect(dialog.getByRole('button', { name: 'Turn on sharing' })).toBeTruthy();
    });

    it('over plain HTTP it carries the warning, with the choice of HTTPS', async () => {
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      const dialog = within(intro());
      expect(dialog.getByText(/With HTTPS off, everything travels across the network as readable text/)).toBeTruthy();
      expect(dialog.queryByText('The first visit shows a warning')).toBeNull();
      expect(dialog.queryByRole('button', { name: 'Turn on sharing' })).toBeNull();
      expect(dialog.getByRole('checkbox', { name: "Don't warn me again on this computer" })).toBeTruthy();
    });

    it('over plain HTTP, Use HTTPS instead sends the mode with enabled: true', async () => {
      routes['POST /sharing'] = () => reply({ ...RUNNING, tls_mode: 'self_signed' });
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('button', { name: 'Use HTTPS instead' }));
      noPopUp();
      await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
      expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'self_signed', enabled: true });
      expect(JSON.parse(localStorage.getItem('sharing_intro_seen'))).toBe(true);
      expect(localStorage.getItem('sharing_http_warning_off')).toBeNull();
      // The state now shows sharing over HTTPS: no warning about plain HTTP follows.
      await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
      noPopUp();
    });

    it('over plain HTTP, Share without encryption sends enabled: true, and no second warning follows', async () => {
      routes['POST /sharing'] = () => reply(RUNNING);
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('button', { name: 'Share without encryption' }));
      await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
      expect(requests('POST /sharing')[0].body).toEqual({ enabled: true });
      expect(JSON.parse(localStorage.getItem('sharing_intro_seen'))).toBe(true);
      noPopUp();
    });

    it('over plain HTTP, the tick box is stored with a button but not with Cancel', async () => {
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('checkbox'));
      fireEvent.click(within(intro()).getByRole('button', { name: 'Cancel' }));
      expect(localStorage.getItem('sharing_http_warning_off')).toBeNull();
      expect(localStorage.getItem('sharing_intro_seen')).toBeNull();

      routes['POST /sharing'] = () => reply(RUNNING);
      fireEvent.click(theSwitch());
      fireEvent.click(within(intro()).getByRole('checkbox'));
      fireEvent.click(within(intro()).getByRole('button', { name: 'Share without encryption' }));
      expect(JSON.parse(localStorage.getItem('sharing_http_warning_off'))).toBe(true);
      expect(JSON.parse(localStorage.getItem('sharing_intro_seen'))).toBe(true);
    });

    it('over plain HTTP with the warning switched off, it shows the plain version', async () => {
      localStorage.setItem('sharing_http_warning_off', 'true');
      await renderSection(VIEW);
      fireEvent.click(theSwitch());
      const dialog = within(intro());
      expect(dialog.queryByText(/readable text/)).toBeNull();
      expect(dialog.getByRole('button', { name: 'Turn on sharing' })).toBeTruthy();
    });

    it('disables its buttons while a request runs', () => {
      render(<SharingIntroModal variant="files" uiTheme="modern" isBusy onTurnOn={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Turn on sharing' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
    });

    it('renders in the terminal style too', async () => {
      await renderSection(SELF_SIGNED, 'terminal');
      fireEvent.click(theSwitch());
      expect(intro().className).toContain('border-white');
      expect(within(intro()).getByRole('button', { name: 'Turn on sharing' })).toBeTruthy();
    });

    it('is in Chinese too', async () => {
      await i18n.changeLanguage('zh-CN');
      routes['GET /sharing'] = () => reply(SELF_SIGNED);
      render(<SharingSection uiTheme="modern" setToast={setToast} />);
      fireEvent.click(await screen.findByRole('switch', { name: '在我的网络上共享' }));
      const dialog = within(screen.getByRole('dialog', { name: '共享前请先了解' }));
      expect(dialog.getByText('Firefox：点击「高级」→「接受风险并继续」')).toBeTruthy();
      await i18n.changeLanguage('en');
    });
  });

  describe('the plain HTTP warning', () => {
    const SELF_SIGNED_RUNNING = { ...RUNNING, tls_mode: 'self_signed' };
    const warning = (name) => screen.getByRole('dialog', { name });
    const noPopUp = () => expect(screen.queryByRole('dialog')).toBeNull();

    beforeEach(() => {
      localStorage.clear();
      localStorage.setItem('sharing_intro_seen', 'true');
    });

    describe('turning sharing on', () => {
      it('opens with the three buttons and sends nothing yet', async () => {
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        const dialog = within(warning('Share without encryption?'));
        expect(dialog.getByText(/With HTTPS off, everything travels across the network as readable text/)).toBeTruthy();
        expect(dialog.getByText('Anyone on the same Wi-Fi or network could see the pictures that are opened.')).toBeTruthy();
        expect(dialog.getByText('They could also copy a signed-in session and use VBLIS as that person.')).toBeTruthy();
        expect(dialog.getByText(/Never on public Wi-Fi/)).toBeTruthy();
        expect(dialog.getByRole('button', { name: 'Use HTTPS instead' })).toBeTruthy();
        expect(dialog.getByRole('button', { name: 'Share without encryption' })).toBeTruthy();
        expect(dialog.getByRole('button', { name: 'Cancel' })).toBeTruthy();
        expect(requests('POST /sharing')).toHaveLength(0);
      });

      it('Use HTTPS instead sends the mode and enabled: true', async () => {
        routes['POST /sharing'] = () => reply(SELF_SIGNED_RUNNING);
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        fireEvent.click(within(warning('Share without encryption?')).getByRole('button', { name: 'Use HTTPS instead' }));
        await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
        expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'self_signed', enabled: true });
        expect(setToast).toHaveBeenCalledWith({ message: 'Sharing is on.', type: 'success' });
        noPopUp();
      });

      it('Share without encryption sends enabled: true, and the running warning does not follow', async () => {
        routes['POST /sharing'] = () => reply(RUNNING);
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        fireEvent.click(within(warning('Share without encryption?')).getByRole('button', { name: 'Share without encryption' }));
        await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
        expect(requests('POST /sharing')[0].body).toEqual({ enabled: true });
        noPopUp();
      });

      it('Cancel, Escape and the backdrop send nothing', async () => {
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        fireEvent.click(within(warning('Share without encryption?')).getByRole('button', { name: 'Cancel' }));
        noPopUp();
        fireEvent.click(theSwitch());
        fireEvent.keyDown(window, { key: 'Escape' });
        noPopUp();
        fireEvent.click(theSwitch());
        fireEvent.click(warning('Share without encryption?').parentElement);
        noPopUp();
        expect(requests('POST /sharing')).toHaveLength(0);
      });

      it('does not open over HTTPS', async () => {
        routes['POST /sharing'] = () => reply(SELF_SIGNED_RUNNING);
        await renderSection({ ...VIEW, tls_mode: 'self_signed' });
        fireEvent.click(theSwitch());
        noPopUp();
        await waitFor(() => expect(requests('POST /sharing')[0].body).toEqual({ enabled: true }));
      });
    });

    describe('the tick box', () => {
      it('is stored when a button is pressed, and then no pop-up opens for any trigger', async () => {
        routes['POST /sharing'] = () => reply(RUNNING);
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        const dialog = within(warning('Share without encryption?'));
        const box = dialog.getByRole('checkbox', { name: "Don't warn me again on this computer" });
        expect(box.checked).toBe(false);
        fireEvent.click(box);
        fireEvent.click(dialog.getByRole('button', { name: 'Share without encryption' }));
        await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
        expect(JSON.parse(localStorage.getItem('sharing_http_warning_off'))).toBe(true);

        // Turn on again over HTTP: no pop-up. Choose Off while sharing: no pop-up. Open with it running: none.
        routes['POST /sharing'] = () => reply(VIEW);
        fireEvent.click(theSwitch());
        await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'));
        routes['POST /sharing'] = () => reply(RUNNING);
        fireEvent.click(theSwitch());
        await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
        noPopUp();

        cleanup();
        resetSharingPromptsForTests();
        await renderSection({ ...SELF_SIGNED_RUNNING });
        routes['POST /sharing'] = () => reply({ ...SELF_SIGNED_RUNNING, tls_mode: 'off' });
        fireEvent.click(screen.getByRole('button', { name: 'Off' }));
        await waitFor(() => expect(requests('POST /sharing').at(-1).body).toEqual({ tls_mode: 'off' }));
        noPopUp();

        cleanup();
        resetSharingPromptsForTests();
        await renderSection(RUNNING);
        noPopUp();
      });

      it('is also stored by Cancel', async () => {
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        fireEvent.click(within(warning('Share without encryption?')).getByRole('checkbox'));
        fireEvent.click(within(warning('Share without encryption?')).getByRole('button', { name: 'Cancel' }));
        expect(JSON.parse(localStorage.getItem('sharing_http_warning_off'))).toBe(true);
        expect(requests('POST /sharing')).toHaveLength(0);
      });

      it('is not stored when it was not ticked', async () => {
        await renderSection(VIEW);
        fireEvent.click(theSwitch());
        fireEvent.click(within(warning('Share without encryption?')).getByRole('button', { name: 'Cancel' }));
        expect(localStorage.getItem('sharing_http_warning_off')).toBeNull();
      });
    });

    describe('choosing HTTPS Off while sharing is on', () => {
      const off = () => screen.getByRole('button', { name: 'Off' });

      it('asks first; Keep HTTPS sends nothing', async () => {
        await renderSection(SELF_SIGNED_RUNNING);
        fireEvent.click(off());
        const dialog = within(warning('Turn HTTPS off?'));
        expect(dialog.getByText(/readable text/)).toBeTruthy();
        expect(requests('POST /sharing')).toHaveLength(0);
        fireEvent.click(dialog.getByRole('button', { name: 'Keep HTTPS' }));
        noPopUp();
        expect(requests('POST /sharing')).toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Self-signed' }).getAttribute('aria-pressed')).toBe('true');
      });

      it('Turn HTTPS off saves the mode, and the running warning does not follow', async () => {
        routes['POST /sharing'] = () => reply({ ...SELF_SIGNED_RUNNING, tls_mode: 'off' });
        await renderSection(SELF_SIGNED_RUNNING);
        fireEvent.click(off());
        fireEvent.click(within(warning('Turn HTTPS off?')).getByRole('button', { name: 'Turn HTTPS off' }));
        await waitFor(() => expect(off().getAttribute('aria-pressed')).toBe('true'));
        expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'off' });
        expect(setToast).toHaveBeenCalledWith({ message: 'Saved.', type: 'success' });
        noPopUp();
      });

      it('Escape and the backdrop keep HTTPS', async () => {
        await renderSection(SELF_SIGNED_RUNNING);
        fireEvent.click(off());
        fireEvent.keyDown(window, { key: 'Escape' });
        noPopUp();
        fireEvent.click(off());
        fireEvent.click(warning('Turn HTTPS off?').parentElement);
        noPopUp();
        expect(requests('POST /sharing')).toHaveLength(0);
      });

      it('saves at once while sharing is off', async () => {
        routes['POST /sharing'] = () => reply(VIEW);
        await renderSection({ ...VIEW, tls_mode: 'self_signed' });
        fireEvent.click(off());
        noPopUp();
        await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
        expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'off' });
      });
    });

    describe('sharing that is already running over plain HTTP', () => {
      // It opens in an effect after the state loaded.
      const runningWarning = () => screen.findByRole('dialog', { name: 'Sharing is not encrypted' });

      it('opens once the state has loaded, and Use HTTPS instead saves the mode', async () => {
        routes['POST /sharing'] = () => reply(SELF_SIGNED_RUNNING);
        await renderSection(RUNNING);
        const dialog = within(await runningWarning());
        expect(dialog.getByRole('button', { name: 'Keep it for now' })).toBeTruthy();
        expect(dialog.queryByRole('button', { name: 'Share without encryption' })).toBeNull();
        fireEvent.click(dialog.getByRole('button', { name: 'Use HTTPS instead' }));
        await waitFor(() => expect(requests('POST /sharing')).toHaveLength(1));
        expect(requests('POST /sharing')[0].body).toEqual({ tls_mode: 'self_signed' });
        expect(setToast).toHaveBeenCalledWith({ message: 'Saved.', type: 'success' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Self-signed' }).getAttribute('aria-pressed')).toBe('true'));
        noPopUp();
      });

      it('Keep it for now closes it, and it shows only once per run', async () => {
        await renderSection(RUNNING);
        fireEvent.click(within(await runningWarning()).getByRole('button', { name: 'Keep it for now' }));
        noPopUp();
        expect(requests('POST /sharing')).toHaveLength(0);

        cleanup();
        await renderSection(RUNNING);
        noPopUp();

        resetSharingPromptsForTests();
        cleanup();
        await renderSection(RUNNING);
        expect(await runningWarning()).toBeTruthy();
      });

      it('Escape closes it without sending anything', async () => {
        await renderSection(RUNNING);
        await runningWarning();
        fireEvent.keyDown(window, { key: 'Escape' });
        noPopUp();
        expect(requests('POST /sharing')).toHaveLength(0);
      });

      it('does not open for HTTPS, for sharing that is off, or for a mode the environment fixes', async () => {
        await renderSection(SELF_SIGNED_RUNNING);
        noPopUp();
        cleanup();
        await renderSection(VIEW);
        noPopUp();
        cleanup();
        await renderSection({ ...RUNNING, from_environment: ['tls_mode'] });
        noPopUp();
      });

      it('does not open once the tick box was ticked', async () => {
        localStorage.setItem('sharing_http_warning_off', 'true');
        await renderSection(RUNNING);
        noPopUp();
      });
    });

    it('disables its buttons while a request runs', () => {
      render(<HttpSharingWarningModal reason="turn_on" uiTheme="modern" isBusy onUseHttps={vi.fn()} onContinue={vi.fn()} onCancel={vi.fn()} />);
      for (const name of ['Use HTTPS instead', 'Share without encryption', 'Cancel']) {
        expect(screen.getByRole('button', { name }).disabled).toBe(true);
      }
      expect(screen.getByRole('checkbox').disabled).toBe(true);
    });

    it('renders in the terminal style too', async () => {
      await renderSection(VIEW, 'terminal');
      fireEvent.click(theSwitch());
      expect(warning('Share without encryption?').className).toContain('border-white');
    });

    it('is in Chinese too', async () => {
      await i18n.changeLanguage('zh-CN');
      routes['GET /sharing'] = () => reply(VIEW);
      render(<SharingSection uiTheme="modern" setToast={setToast} />);
      fireEvent.click(await screen.findByRole('switch', { name: '在我的网络上共享' }));
      const dialog = within(screen.getByRole('dialog', { name: '要在不加密的情况下共享吗？' }));
      expect(dialog.getByRole('button', { name: '改用 HTTPS' })).toBeTruthy();
      expect(dialog.getByRole('button', { name: '不加密共享' })).toBeTruthy();
      expect(dialog.getByRole('checkbox', { name: '在这台电脑上不再提醒' })).toBeTruthy();
      await i18n.changeLanguage('en');
    });
  });

  describe('Chinese', () => {
    it('shows the switch, the heading and the problems in zh-CN', async () => {
      await i18n.changeLanguage('zh-CN');
      routes['GET /sharing'] = () => reply({ ...VIEW, enabled: true, problems: [{ code: 'port_in_use', message: 'in use' }] });
      render(<SharingSection uiTheme="modern" setToast={setToast} />);
      expect(await screen.findByRole('switch', { name: '在我的网络上共享' })).toBeTruthy();
      expect(screen.getByText('该端口已被其他程序占用。请换一个端口。')).toBeTruthy();
      expect(screen.getByRole('heading', { name: '网络共享' })).toBeTruthy();
    });
  });
});
