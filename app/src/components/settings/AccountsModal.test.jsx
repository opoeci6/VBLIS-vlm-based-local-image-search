import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { resetEscapeKeyForTests, useEscapeKey } from '../../hooks/useEscapeKey';
import i18n from '../../i18n';
import { SessionContext } from '../../session/sessionContext';
import { AccountsModal } from './AccountsModal';

const ALL = { originals: true, image_search: true, places: true };

const LIST = {
  accounts: [
    { id: 'a1', name: 'alice', role: 'owner', permissions: ALL, disabled: false },
    { id: 'o2', name: 'olivia', role: 'owner', permissions: ALL, disabled: false },
    { id: 'v1', name: 'bob', role: 'viewer', permissions: { originals: false, image_search: true, places: true }, disabled: false },
    { id: 'v2', name: 'carol', role: 'viewer', permissions: { originals: true, image_search: false, places: false }, disabled: true },
  ],
  you: 'a1',
  limits: { max_accounts: 50, name_max: 20, password_min: 8, password_max: 256 },
};

const SESSION = {
  mode: 'network',
  signedIn: true,
  role: 'owner',
  isOwner: true,
  account: { id: 'a1', name: 'alice' },
  permissions: ALL,
  may: () => true,
};

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

const refusal = (code, detail = 'English detail', status = 400) => () => reply({ detail, code }, status);

describe('AccountsModal', () => {
  let routes;
  let fetchMock;
  let onClose;
  let setToast;
  let session;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderModal = async (uiTheme = 'modern') => {
    render(
      <SessionContext.Provider value={session}>
        <AccountsModal uiTheme={uiTheme} onClose={onClose} setToast={setToast} />
      </SessionContext.Provider>
    );
    await screen.findByRole('table', { name: 'Accounts' });
  };

  const rowOf = (name) => screen.getByText(name, { selector: 'span.truncate' }).closest('[role="row"]');
  const switchOf = (label, name) => screen.getByRole('switch', { name: `${label} for ${name}` });
  const ORIGINALS = 'Open and download original files';
  const IMAGE_SEARCH = 'Search with a picture';
  const PLACES = 'See places and filter by place';
  const ON = 'Account turned on';

  const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  const pick = (name, item) => {
    openMenu(name);
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
  };
  const password = (value, label = 'Your current password') => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const submitStep = (name) => fireEvent.click(within(screen.getByRole('dialog', { name: /^(?!Accounts$)/ })).getByRole('button', { name }));
  const stepDialog = (title) => screen.findByRole('dialog', { name: title });

  beforeEach(() => {
    onClose = vi.fn();
    setToast = vi.fn();
    session = { ...SESSION, signOut: vi.fn(), refresh: vi.fn() };
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
    resetEscapeKeyForTests();
    vi.unstubAllGlobals();
  });

  describe('the list', () => {
    it('shows each account with its role, the "you" and "off" badges and "always" on owner rows', async () => {
      await renderModal();
      expect(screen.getByRole('dialog', { name: 'Accounts' })).toBeTruthy();
      expect(within(rowOf('alice')).getAllByText('Owner').length).toBeGreaterThan(0);
      expect(within(rowOf('alice')).getByText('you')).toBeTruthy();
      expect(within(rowOf('bob')).getByText('Viewer')).toBeTruthy();
      expect(within(rowOf('bob')).queryByText('you')).toBeNull();
      expect(within(rowOf('carol')).getByText('off')).toBeTruthy();
      expect(within(rowOf('bob')).queryByText('off')).toBeNull();
      // Two owner rows, three permission cells each.
      expect(screen.getAllByText('always')).toHaveLength(6);
      expect(within(rowOf('alice')).queryAllByRole('switch').length).toBe(1);
      expect(within(rowOf('bob')).getAllByRole('switch')).toHaveLength(4);
    });

    it('cancels the margin of the spaced Settings section it opens from', async () => {
      // Without it, `space-y-*` pushed the full-screen phone window 16 px down and cut off its bottom.
      await renderModal();
      expect(screen.getByRole('dialog', { name: 'Accounts' }).parentElement.className).toMatch(/(^|\s)!m-0(\s|$)/);
    });

    it('has a header row with the column names', async () => {
      await renderModal();
      const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
      expect(headers).toEqual(['Name', 'Role', 'Originals', 'Picture search', 'Places', 'On', 'Actions']);
    });

    it('shows the state of every switch', async () => {
      await renderModal();
      expect(switchOf(ORIGINALS, 'bob').getAttribute('aria-checked')).toBe('false');
      expect(switchOf(IMAGE_SEARCH, 'bob').getAttribute('aria-checked')).toBe('true');
      expect(switchOf(ON, 'bob').getAttribute('aria-checked')).toBe('true');
      expect(switchOf(ON, 'carol').getAttribute('aria-checked')).toBe('false');
    });

    it('shows a loading line, then the table', async () => {
      render(
        <SessionContext.Provider value={session}>
          <AccountsModal onClose={onClose} setToast={setToast} />
        </SessionContext.Provider>
      );
      expect(screen.getByRole('status').textContent).toBe('Loading accounts...');
      await screen.findByRole('table', { name: 'Accounts' });
    });

    it('says so when the list cannot be loaded and retries', async () => {
      routes['GET /server/accounts'] = () => reply({ detail: 'x' }, 500);
      render(
        <SessionContext.Provider value={session}>
          <AccountsModal onClose={onClose} setToast={setToast} />
        </SessionContext.Provider>
      );
      expect((await screen.findByRole('alert')).textContent).toBe('Could not load the accounts.');
      routes['GET /server/accounts'] = () => reply(LIST);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByRole('table', { name: 'Accounts' });
      expect(requests('GET /server/accounts')).toHaveLength(2);
    });

    it('shows the location hint for a viewer with originals on and places off', async () => {
      await renderModal();
      const hint = 'Original files still contain their location, even with Places off.';
      expect(within(rowOf('carol')).getByText(hint)).toBeTruthy();
      expect(within(rowOf('bob')).queryByText(hint)).toBeNull();
      expect(screen.getAllByText(hint)).toHaveLength(1);
    });

    it('renders the switches in the terminal style', async () => {
      await renderModal('terminal');
      expect(within(rowOf('bob')).getAllByRole('switch')).toHaveLength(4);
      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      fireEvent.click(switchOf(IMAGE_SEARCH, 'bob'));
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(1));
    });
  });

  describe('inline changes of a viewer (taking access away)', () => {
    it.each([
      ['originals', ORIGINALS, 'carol', 'v2', { permissions: { originals: false } }],
      ['picture search', IMAGE_SEARCH, 'bob', 'v1', { permissions: { image_search: false } }],
      ['places', PLACES, 'bob', 'v1', { permissions: { places: false } }],
      ['turning off', ON, 'bob', 'v1', { disabled: true }],
    ])('sends only the changed %s, with no password', async (_name, label, name, id, body) => {
      routes[`PATCH /server/accounts/${id}`] = () => reply(LIST);
      await renderModal();
      fireEvent.click(switchOf(label, name));
      await waitFor(() => expect(requests(`PATCH /server/accounts/${id}`)).toHaveLength(1));
      expect(requests(`PATCH /server/accounts/${id}`)[0].body).toEqual(body);
      expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull();
    });

    it('takes the new list from the answer', async () => {
      const changed = { ...LIST, accounts: LIST.accounts.map((a) => (a.id === 'v1' ? { ...a, permissions: { ...a.permissions, image_search: false } } : a)) };
      routes['PATCH /server/accounts/v1'] = () => reply(changed);
      await renderModal();
      fireEvent.click(switchOf(IMAGE_SEARCH, 'bob'));
      await waitFor(() => expect(switchOf(IMAGE_SEARCH, 'bob').getAttribute('aria-checked')).toBe('false'));
    });

    it('marks the pending switch busy and locks the row until the answer', async () => {
      let finish;
      routes['PATCH /server/accounts/v1'] = () => new Promise((resolve) => { finish = () => resolve(reply(LIST)); });
      await renderModal();
      fireEvent.click(switchOf(IMAGE_SEARCH, 'bob'));
      await waitFor(() => expect(switchOf(IMAGE_SEARCH, 'bob').getAttribute('aria-busy')).toBe('true'));
      expect(switchOf(PLACES, 'bob').disabled).toBe(true);
      expect(switchOf(PLACES, 'bob').getAttribute('aria-busy')).toBeNull();
      expect(screen.getByRole('button', { name: 'More actions for bob' }).disabled).toBe(true);
      // Other rows stay usable.
      expect(switchOf(ORIGINALS, 'carol').disabled).toBe(false);
      finish();
      await waitFor(() => expect(switchOf(PLACES, 'bob').disabled).toBe(false));
    });

    it('shows the refusal in the row, and clears it when the next action starts', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('last_owner');
      await renderModal();
      fireEvent.click(switchOf(ON, 'bob'));
      const alert = await within(rowOf('bob')).findByRole('alert');
      expect(alert.textContent).toBe('At least one owner account has to stay, and be turned on.');
      expect(within(rowOf('carol')).queryByRole('alert')).toBeNull();

      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      fireEvent.click(switchOf(PLACES, 'bob'));
      await waitFor(() => expect(within(rowOf('bob')).queryByRole('alert')).toBeNull());
    });

    it('shows the server detail for an unknown code', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('brand_new', 'Something odd happened');
      await renderModal();
      fireEvent.click(switchOf(PLACES, 'bob'));
      expect((await within(rowOf('bob')).findByRole('alert')).textContent).toBe('Something odd happened');
    });
  });

  describe('giving a viewer access asks for the password', () => {
    it.each([
      ['originals', ORIGINALS, 'bob', 'v1', 'Let bob open and download original files?', 'originals'],
      ['picture search', IMAGE_SEARCH, 'carol', 'v2', 'Let carol search with a picture?', 'image_search'],
      ['places', PLACES, 'carol', 'v2', 'Let carol see places and filter by place?', 'places'],
    ])('switching %s on', async (_name, label, name, id, title, api) => {
      routes[`PATCH /server/accounts/${id}`] = () => reply(LIST);
      await renderModal();
      fireEvent.click(switchOf(label, name));
      const dialog = await stepDialog(title);
      expect(within(dialog).getByText(`This gives ${name} more access, so it needs your password. Switching it off again doesn't.`)).toBeTruthy();
      expect(requests(`PATCH /server/accounts/${id}`)).toHaveLength(0);

      submitStep('Allow');
      expect((await within(dialog).findByRole('alert')).textContent).toBe('Enter your current password to confirm.');
      expect(requests(`PATCH /server/accounts/${id}`)).toHaveLength(0);

      password('mine-1234');
      submitStep('Allow');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
      expect(requests(`PATCH /server/accounts/${id}`)[0].body).toEqual({ permissions: { [api]: true }, current_password: 'mine-1234' });
    });

    it('turning a viewer back on', async () => {
      routes['PATCH /server/accounts/v2'] = () => reply(LIST);
      await renderModal();
      fireEvent.click(switchOf(ON, 'carol'));
      await stepDialog('Turn on carol?');
      expect(requests('PATCH /server/accounts/v2')).toHaveLength(0);
      password('mine-1234');
      submitStep('Turn on');
      await waitFor(() => expect(requests('PATCH /server/accounts/v2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v2')[0].body).toEqual({ disabled: false, current_password: 'mine-1234' });
    });

    it('sends nothing when cancelled, and shows a refusal in the step', async () => {
      await renderModal();
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      await stepDialog('Let bob open and download original files?');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Let bob open and download original files?' })).toBeNull());
      expect(requests('PATCH /server/accounts/v1')).toHaveLength(0);
      expect(switchOf(ORIGINALS, 'bob').getAttribute('aria-checked')).toBe('false');

      routes['PATCH /server/accounts/v1'] = refusal('wrong_password', 'English', 403);
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      const dialog = await stepDialog('Let bob open and download original files?');
      password('nope-nope');
      submitStep('Allow');
      expect((await within(dialog).findByRole('alert')).textContent).toBe('The current password is wrong.');
      expect(within(rowOf('bob')).queryByRole('alert')).toBeNull();
    });
  });

  describe('turning an owner on or off', () => {
    it('asks for the password first, and patches disabled with it', async () => {
      routes['PATCH /server/accounts/o2'] = () => reply({ ...LIST, accounts: LIST.accounts.map((a) => (a.id === 'o2' ? { ...a, disabled: true } : a)) });
      await renderModal();
      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn off olivia?');
      expect(requests('PATCH /server/accounts/o2')).toHaveLength(0);

      submitStep('Turn off');
      expect((await screen.findByText('Enter your current password to confirm.')).getAttribute('role')).toBe('alert');
      expect(requests('PATCH /server/accounts/o2')).toHaveLength(0);

      password('mine-1234');
      submitStep('Turn off');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn off olivia?' })).toBeNull());
      expect(requests('PATCH /server/accounts/o2')[0].body).toEqual({ disabled: true, current_password: 'mine-1234' });
      expect(within(rowOf('olivia')).getByText('off')).toBeTruthy();
    });

    it('turns an owner on with disabled: false', async () => {
      const off = { ...LIST, accounts: LIST.accounts.map((a) => (a.id === 'o2' ? { ...a, disabled: true } : a)) };
      routes['GET /server/accounts'] = () => reply(off);
      routes['PATCH /server/accounts/o2'] = () => reply(LIST);
      await renderModal();
      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn on olivia?');
      password('mine-1234');
      submitStep('Turn on');
      await waitFor(() => expect(requests('PATCH /server/accounts/o2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/o2')[0].body).toEqual({ disabled: false, current_password: 'mine-1234' });
    });

    it('shows the refusal in the step and keeps it open', async () => {
      routes['PATCH /server/accounts/o2'] = refusal('wrong_password', 'English', 403);
      await renderModal();
      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn off olivia?');
      password('nope-nope');
      submitStep('Turn off');
      const dialog = screen.getByRole('dialog', { name: 'Turn off olivia?' });
      expect((await within(dialog).findByRole('alert')).textContent).toBe('The current password is wrong.');
      expect(within(rowOf('olivia')).queryByRole('alert')).toBeNull();
    });
  });

  describe('your own row', () => {
    it('has the On switch, Change role and Delete disabled with a tooltip', async () => {
      await renderModal();
      const own = switchOf(ON, 'alice');
      expect(own.disabled).toBe(true);
      expect(own.getAttribute('title')).toBe("You can't do this to your own account.");
      openMenu('alice');
      for (const name of ['Change role', 'Delete']) {
        const item = screen.getByRole('menuitem', { name });
        expect(item.disabled).toBe(true);
        expect(item.getAttribute('title')).toBe("You can't do this to your own account.");
      }
      for (const name of ['Rename', 'Set password', 'Sign out everywhere']) {
        expect(screen.getByRole('menuitem', { name }).disabled).toBe(false);
      }
    });

    it('leaves nothing disabled in another owner row', async () => {
      await renderModal();
      openMenu('olivia');
      expect(screen.getByRole('menuitem', { name: 'Delete' }).disabled).toBe(false);
      expect(screen.getByRole('menuitem', { name: 'Change role' }).disabled).toBe(false);
      expect(switchOf(ON, 'olivia').disabled).toBe(false);
    });
  });

  describe('the actions menu', () => {
    it('opens with the five actions and flags itself as a menu', async () => {
      await renderModal();
      const button = screen.getByRole('button', { name: 'More actions for bob' });
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const menu = screen.getByRole('menu');
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent))
        .toEqual(['Rename', 'Change role', 'Set password', 'Sign out everywhere', 'Delete']);
    });

    it('toggles on its button, and shows one menu at a time', async () => {
      await renderModal();
      openMenu('bob');
      openMenu('carol');
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      openMenu('carol');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on a mouse press outside, but not inside, and when an item is picked', async () => {
      await renderModal();
      openMenu('bob');
      fireEvent.mouseDown(screen.getByRole('menu'));
      expect(screen.getByRole('menu')).toBeTruthy();
      fireEvent.mouseDown(screen.getByRole('table'));
      expect(screen.queryByRole('menu')).toBeNull();
      pick('bob', 'Rename');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('sits outside the scrolling list and the window, so a short list cannot cut it off', async () => {
      await renderModal();
      openMenu('bob');
      const menu = screen.getByRole('menu', { name: 'More actions for bob' });
      const accounts = screen.getByRole('dialog', { name: 'Accounts' });
      expect(accounts.contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(accounts.parentElement);
      expect(screen.getByRole('button', { name: 'More actions for bob' }).getAttribute('aria-controls')).toBe(menu.id);
      // Picking an action doesn't count as a click on the backdrop
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      expect(onClose).not.toHaveBeenCalled();
    });

    describe('placement', () => {
      let rects;
      let spies;
      beforeEach(() => {
        rects = new Map();
        const box = ({ top = 0, bottom = 0, right = 0 }) => ({ top, bottom, right, left: 0, height: bottom - top, width: right, x: 0, y: top });
        spies = [
          vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            return box(rects.get(this) ?? {});
          }),
          vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height() {
            return this.getAttribute('role') === 'menu' ? 180 : 0;
          }),
        ];
      });
      afterEach(() => spies.forEach((spy) => spy.mockRestore()));

      const openAt = (overlay, button) => {
        rects.set(screen.getByRole('dialog', { name: 'Accounts' }).parentElement, overlay);
        rects.set(screen.getByRole('button', { name: 'More actions for bob' }).parentElement, button);
        openMenu('bob');
        return screen.getByRole('menu').style;
      };

      it('opens under its button when there is room', async () => {
        await renderModal();
        const style = openAt({ top: 0, bottom: 800, right: 1000 }, { top: 100, bottom: 140, right: 900 });
        expect([style.top, style.bottom, style.right, style.visibility]).toEqual(['144px', '', '100px', '']);
      });

      it('opens above its button near the bottom of the window', async () => {
        await renderModal();
        const style = openAt({ top: 0, bottom: 300, right: 1000 }, { top: 200, bottom: 240, right: 900 });
        expect([style.top, style.bottom, style.right]).toEqual(['', '104px', '100px']);
      });

      it('stays inside a window too short for either side', async () => {
        await renderModal();
        const style = openAt({ top: 0, bottom: 150, right: 1000 }, { top: 50, bottom: 90, right: 900 });
        expect([style.top, style.bottom]).toEqual(['4px', '']);
      });
    });

    it('closes when the list scrolls or the window is resized', async () => {
      await renderModal();
      openMenu('bob');
      fireEvent.scroll(screen.getByRole('table').parentElement);
      expect(screen.queryByRole('menu')).toBeNull();
      openMenu('bob');
      fireEvent(window, new Event('resize'));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('takes the keyboard: the first action, Up and Down over the enabled ones, Esc back to the button', async () => {
      await renderModal();
      // A browser ignores focus() on a hidden element, so the menu must be placed (visible) by then
      const focusOf = HTMLElement.prototype.focus;
      const visibilityAtFocus = [];
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function focus(...args) {
        if (this.getAttribute('role') === 'menuitem') visibilityAtFocus.push(this.closest('[role="menu"]').style.visibility);
        return focusOf.apply(this, args);
      });
      openMenu('alice');
      focusSpy.mockRestore();
      expect(visibilityAtFocus).toEqual(['']);
      const item = (name) => screen.getByRole('menuitem', { name });
      expect(document.activeElement).toBe(item('Rename'));
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(item('Set password'));
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(item('Rename'));
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(item('Sign out everywhere'));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions for alice' }));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('is prefilled, checks the name, and patches name with the password', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      await renderModal();
      pick('bob', 'Rename');
      await stepDialog('Rename bob');
      const field = screen.getByLabelText('New name');
      expect(field.value).toBe('bob');
      expect(document.activeElement).toBe(field);

      fireEvent.change(field, { target: { value: '   ' } });
      password('mine-1234');
      submitStep('Rename');
      expect((await screen.findByRole('alert')).textContent).toBe('Enter a name.');

      fireEvent.change(field, { target: { value: 'x'.repeat(21) } });
      submitStep('Rename');
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A name can have at most 20 characters.'));
      expect(requests('PATCH /server/accounts/v1')).toHaveLength(0);

      fireEvent.change(field, { target: { value: '  robert  ' } });
      submitStep('Rename');
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v1')[0].body).toEqual({ name: 'robert', current_password: 'mine-1234' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename bob' })).toBeNull());
      expect(session.refresh).not.toHaveBeenCalled();
    });

    it('needs the password', async () => {
      await renderModal();
      pick('bob', 'Rename');
      await stepDialog('Rename bob');
      submitStep('Rename');
      expect((await screen.findByRole('alert')).textContent).toBe('Enter your current password to confirm.');
      expect(requests('PATCH /server/accounts/v1')).toHaveLength(0);
    });

    it('refreshes the session when it is your own account', async () => {
      routes['PATCH /server/accounts/a1'] = () => reply(LIST);
      await renderModal();
      pick('alice', 'Rename');
      await stepDialog('Rename alice');
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'alicia' } });
      password('mine-1234');
      submitStep('Rename');
      await waitFor(() => expect(session.refresh).toHaveBeenCalledTimes(1));
      expect(requests('PATCH /server/accounts/a1')[0].body).toEqual({ name: 'alicia', current_password: 'mine-1234' });
    });

    it('shows name_taken in the step and keeps it open', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('name_taken', 'English', 409);
      await renderModal();
      pick('bob', 'Rename');
      await stepDialog('Rename bob');
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'carol' } });
      password('mine-1234');
      submitStep('Rename');
      expect((await screen.findByRole('alert')).textContent).toBe('Another account already has this name.');
      expect(screen.getByRole('dialog', { name: 'Rename bob' })).toBeTruthy();
      expect(session.refresh).not.toHaveBeenCalled();
    });
  });

  describe('change role', () => {
    it('promotes a viewer to owner', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      await renderModal();
      pick('bob', 'Change role');
      await stepDialog('Make bob an owner?');
      expect(screen.getByText('Owners can change every setting, manage accounts and open every file.')).toBeTruthy();
      password('mine-1234');
      submitStep('Make owner');
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v1')[0].body).toEqual({ role: 'owner', current_password: 'mine-1234' });
    });

    it('demotes an owner to viewer', async () => {
      routes['PATCH /server/accounts/o2'] = () => reply(LIST);
      await renderModal();
      pick('olivia', 'Change role');
      await stepDialog('Make olivia a viewer?');
      password('mine-1234');
      submitStep('Make viewer');
      await waitFor(() => expect(requests('PATCH /server/accounts/o2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/o2')[0].body).toEqual({ role: 'viewer', current_password: 'mine-1234' });
    });

    it('shows last_owner in the step', async () => {
      routes['PATCH /server/accounts/o2'] = refusal('last_owner', 'English', 409);
      await renderModal();
      pick('olivia', 'Change role');
      await stepDialog('Make olivia a viewer?');
      password('mine-1234');
      submitStep('Make viewer');
      expect((await screen.findByRole('alert')).textContent).toBe('At least one owner account has to stay, and be turned on.');
    });
  });

  describe('set password', () => {
    const open = async (name = 'bob') => {
      pick(name, 'Set password');
      return stepDialog(`Set a password for ${name}`);
    };
    const fill = ({ next = 'new-password-1', repeat = next, current = 'mine-1234' } = {}) => {
      password(next, 'New password');
      password(repeat, 'Repeat the new password');
      password(current);
    };

    it.each([
      ['the passwords differ', { next: 'new-password-1', repeat: 'new-password-2' }, 'The two new passwords do not match.'],
      ['the password is too short', { next: 'short' }, 'The password must be at least 8 characters.'],
      ['the password is too long', { next: 'x'.repeat(257) }, 'The password must be at most 256 characters.'],
      ['the current password is missing', { current: '' }, 'Enter your current password to confirm.'],
    ])('blocks the request when %s', async (_name, values, message) => {
      await renderModal();
      await open();
      fill(values);
      submitStep('Set password');
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(requests('POST /server/accounts/v1/password')).toHaveLength(0);
    });

    it('posts both passwords, toasts and closes', async () => {
      routes['POST /server/accounts/v1/password'] = () => reply(LIST);
      await renderModal();
      await open();
      expect(screen.getByText('bob is signed out everywhere and signs in again with the new password.')).toBeTruthy();
      fill();
      submitStep('Set password');
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The password of bob was set.', type: 'success' }));
      expect(requests('POST /server/accounts/v1/password')[0].body).toEqual({ new_password: 'new-password-1', current_password: 'mine-1234' });
      expect(screen.queryByRole('dialog', { name: 'Set a password for bob' })).toBeNull();
    });

    it('explains the effect on your own browsers for your own account', async () => {
      await renderModal();
      await open('alice');
      expect(screen.getByText('Your other browsers are signed out. This browser stays signed in.')).toBeTruthy();
    });

    it('shows the refusal and keeps the fields', async () => {
      routes['POST /server/accounts/v1/password'] = refusal('wrong_password', 'English', 403);
      await renderModal();
      await open();
      fill();
      submitStep('Set password');
      expect((await screen.findByRole('alert')).textContent).toBe('The current password is wrong.');
      expect(screen.getByLabelText('New password').value).toBe('new-password-1');
      expect(setToast).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('posts the password to /delete and the account is gone', async () => {
      routes['POST /server/accounts/v1/delete'] = () => reply({ ...LIST, accounts: LIST.accounts.filter((a) => a.id !== 'v1') });
      await renderModal();
      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      expect(screen.getByText("bob can no longer sign in. This can't be undone.")).toBeTruthy();
      password('mine-1234');
      submitStep('Delete account');
      await waitFor(() => expect(screen.queryByText('bob', { selector: 'span.truncate' })).toBeNull());
      expect(requests('POST /server/accounts/v1/delete')[0].body).toEqual({ current_password: 'mine-1234' });
      expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull();
    });

    it('shows the refusal for an unknown code with its detail', async () => {
      routes['POST /server/accounts/v1/delete'] = refusal('brand_new', 'Something odd happened');
      await renderModal();
      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      password('mine-1234');
      submitStep('Delete account');
      expect((await screen.findByRole('alert')).textContent).toBe('Something odd happened');
    });

    it('shows the working state and ignores Esc, Cancel and the backdrop until done', async () => {
      let finish;
      routes['POST /server/accounts/v1/delete'] = () => new Promise((resolve) => { finish = () => resolve(reply(LIST)); });
      await renderModal();
      pick('bob', 'Delete');
      const dialog = await stepDialog('Delete bob?');
      password('mine-1234');
      submitStep('Delete account');
      const saving = await within(dialog).findByRole('button', { name: 'Saving...' });
      expect(saving.disabled).toBe(true);
      expect(within(dialog).getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
      expect(screen.getByLabelText('Your current password').disabled).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(dialog.parentElement);
      expect(screen.getByRole('dialog', { name: 'Delete bob?' })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      finish();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull());
    });
  });

  describe('sign out everywhere', () => {
    it('posts with no body and toasts the name', async () => {
      routes['POST /server/accounts/v1/sign-out'] = () => reply(LIST);
      await renderModal();
      pick('bob', 'Sign out everywhere');
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'bob was signed out everywhere.', type: 'success' }));
      const [call] = requests('POST /server/accounts/v1/sign-out');
      expect(call.init).toEqual({ method: 'POST' });
      expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull();
    });

    it('toasts that your other browsers were signed out for your own row', async () => {
      routes['POST /server/accounts/a1/sign-out'] = () => reply(LIST);
      await renderModal();
      pick('alice', 'Sign out everywhere');
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Your other browsers were signed out.', type: 'success' }));
    });

    it('shows a failure in the row', async () => {
      routes['POST /server/accounts/v1/sign-out'] = refusal('no_account', 'English', 404);
      await renderModal();
      pick('bob', 'Sign out everywhere');
      expect((await within(rowOf('bob')).findByRole('alert')).textContent).toBe('This account no longer exists.');
      expect(setToast).not.toHaveBeenCalled();
    });
  });

  describe('add account', () => {
    const openCard = () => fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const fillCard = ({ name = 'dave', pw = 'pass-word-1', repeat = pw, current = 'mine-1234' } = {}) => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
      fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: repeat } });
      fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: current } });
    };
    const submitCard = () => fireEvent.click(within(screen.getByRole('form', { name: 'New account' })).getByRole('button', { name: 'Add account' }));

    it('opens a card with a focused name, Viewer chosen and the default permissions', async () => {
      await renderModal();
      expect(screen.queryByRole('form', { name: 'New account' })).toBeNull();
      openCard();
      const card = screen.getByRole('form', { name: 'New account' });
      const name = within(card).getByLabelText('Name');
      expect(document.activeElement).toBe(name);
      expect(name.getAttribute('autocomplete')).toBe('off');
      expect(within(card).getByText('1 to 20 letters or digits. . _ and - are allowed, spaces are not.')).toBeTruthy();
      expect(within(card).getByRole('button', { name: 'Viewer' }).getAttribute('aria-pressed')).toBe('true');
      expect(within(card).getByRole('button', { name: 'Owner' }).getAttribute('aria-pressed')).toBe('false');
      expect(within(card).getByRole('switch', { name: ORIGINALS }).getAttribute('aria-checked')).toBe('false');
      expect(within(card).getByRole('switch', { name: IMAGE_SEARCH }).getAttribute('aria-checked')).toBe('true');
      expect(within(card).getByRole('switch', { name: PLACES }).getAttribute('aria-checked')).toBe('true');
      expect(within(card).getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
    });

    it('posts a viewer with the permissions, then closes, resets and toasts', async () => {
      routes['POST /server/accounts'] = () => reply({ ...LIST, accounts: [...LIST.accounts, { id: 'v3', name: 'dave', role: 'viewer', permissions: ALL, disabled: false }] });
      await renderModal();
      openCard();
      fillCard();
      fireEvent.click(screen.getByRole('switch', { name: ORIGINALS }));
      fireEvent.click(screen.getByRole('switch', { name: PLACES }));
      submitCard();
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The account dave was added.', type: 'success' }));
      expect(requests('POST /server/accounts')[0].body).toEqual({
        name: 'dave',
        role: 'viewer',
        password: 'pass-word-1',
        permissions: { originals: true, image_search: true, places: false },
        current_password: 'mine-1234',
      });
      expect(screen.queryByRole('form', { name: 'New account' })).toBeNull();
      expect(rowOf('dave')).toBeTruthy();
      openCard();
      expect(screen.getByLabelText('Name').value).toBe('');
    });

    it('posts an owner without permissions and hides the switches', async () => {
      routes['POST /server/accounts'] = () => reply(LIST);
      await renderModal();
      openCard();
      fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
      expect(screen.queryByRole('switch', { name: ORIGINALS })).toBeNull();
      fillCard({ name: 'erin' });
      submitCard();
      await waitFor(() => expect(requests('POST /server/accounts')).toHaveLength(1));
      expect(requests('POST /server/accounts')[0].body).toEqual({ name: 'erin', role: 'owner', password: 'pass-word-1', current_password: 'mine-1234' });
    });

    it('shows the location hint while originals is on and places is off', async () => {
      await renderModal();
      openCard();
      const card = within(screen.getByRole('form', { name: 'New account' }));
      const hint = 'Original files still contain their location, even with Places off.';
      expect(card.queryByText(hint)).toBeNull();
      fireEvent.click(card.getByRole('switch', { name: ORIGINALS }));
      expect(card.queryByText(hint)).toBeNull();
      fireEvent.click(card.getByRole('switch', { name: PLACES }));
      expect(card.getByText(hint)).toBeTruthy();
    });

    it('checks in order: name, name length, match, short, long, current password', async () => {
      await renderModal();
      openCard();
      const expectAlert = async (text) => {
        submitCard();
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
      };
      fillCard({ name: ' ', pw: 'a', repeat: 'b', current: '' });
      await expectAlert('Enter a name.');
      fillCard({ name: 'x'.repeat(21), pw: 'a', repeat: 'b', current: '' });
      await expectAlert('A name can have at most 20 characters.');
      fillCard({ pw: 'a', repeat: 'b', current: '' });
      await expectAlert('The two new passwords do not match.');
      fillCard({ pw: 'short', current: '' });
      await expectAlert('The password must be at least 8 characters.');
      fillCard({ pw: 'x'.repeat(257), current: '' });
      await expectAlert('The password must be at most 256 characters.');
      fillCard({ current: '' });
      await expectAlert('Enter your current password to confirm.');
      expect(requests('POST /server/accounts')).toHaveLength(0);
    });

    it('shows name_taken in the card and keeps the fields', async () => {
      routes['POST /server/accounts'] = refusal('name_taken', 'English', 409);
      await renderModal();
      openCard();
      fillCard({ name: 'bob' });
      submitCard();
      const card = screen.getByRole('form', { name: 'New account' });
      expect((await within(card).findByRole('alert')).textContent).toBe('Another account already has this name.');
      expect(within(card).getByLabelText('Name').value).toBe('bob');
      expect(setToast).not.toHaveBeenCalled();
    });

    it('closes and resets with Cancel', async () => {
      await renderModal();
      openCard();
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'half' } });
      fireEvent.click(within(screen.getByRole('form', { name: 'New account' })).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('form', { name: 'New account' })).toBeNull();
      openCard();
      expect(screen.getByLabelText('Name').value).toBe('');
    });

    it('is disabled with a tooltip when the account limit is reached', async () => {
      routes['GET /server/accounts'] = () => reply({ ...LIST, limits: { ...LIST.limits, max_accounts: 4 } });
      await renderModal();
      const button = screen.getByRole('button', { name: 'Add account' });
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toBe('There can be at most 4 accounts.');
      fireEvent.click(button);
      expect(screen.queryByRole('form', { name: 'New account' })).toBeNull();
    });
  });

  describe('closing', () => {
    it('closes the menu first, then the step, then the dialog on Esc', async () => {
      await renderModal();
      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      openMenu('carol');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Delete bob?' })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes with the close button', async () => {
      await renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('leaves Esc to a view opened above it, and takes it back when that one closes', async () => {
      const lower = vi.fn();
      const upper = vi.fn();
      const View = ({ onEscape }) => {
        useEscapeKey(true, onEscape);
        return null;
      };
      const tree = (withUpper) => (
        <SessionContext.Provider value={session}>
          <View onEscape={lower} />
          <AccountsModal onClose={onClose} setToast={setToast} />
          {withUpper && <View onEscape={upper} />}
        </SessionContext.Provider>
      );
      const { rerender } = render(tree(true));
      await screen.findByRole('table', { name: 'Accounts' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(upper).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();

      rerender(tree(false));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(lower).not.toHaveBeenCalled();
    });

    it('closes on a click on the backdrop, not on the panel', async () => {
      await renderModal();
      const dialog = screen.getByRole('dialog', { name: 'Accounts' });
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(dialog.parentElement);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes only the step on a click on the step backdrop, and with Cancel', async () => {
      await renderModal();
      pick('bob', 'Delete');
      const step = await stepDialog('Delete bob?');
      fireEvent.click(step);
      expect(screen.getByRole('dialog', { name: 'Delete bob?' })).toBeTruthy();
      fireEvent.click(step.parentElement);
      expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      pick('bob', 'Delete');
      fireEvent.click(within(await stepDialog('Delete bob?')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('the Back button on a phone', () => {
    // jsdom runs history traversals asynchronously and fires popstate, like a browser: wait for them to land.
    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const back = async () => {
      await act(async () => { window.history.back(); });
      await settle();
    };
    let pushState;

    beforeEach(() => {
      window.history.replaceState(null, '');
      pushState = vi.spyOn(window.history, 'pushState');
    });

    afterEach(async () => {
      cleanup();
      await settle();
      resetBackToCloseForTests();
      setNetworkModeForTests(false);
      vi.restoreAllMocks();
      window.history.replaceState(null, '');
    });

    it('makes no history calls outside network mode', async () => {
      await renderModal();
      await settle();
      expect(pushState).not.toHaveBeenCalled();
    });

    it('closes the window in network mode', async () => {
      setNetworkModeForTests(true);
      await renderModal();
      await settle();
      expect(pushState).toHaveBeenCalledTimes(1);
      await back();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes a confirm step first, then the window', async () => {
      setNetworkModeForTests(true);
      await renderModal();
      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      await settle();
      expect(pushState).toHaveBeenCalledTimes(2);

      await back();
      expect(screen.queryByRole('dialog', { name: 'Delete bob?' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await back();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Chinese', () => {
    it('shows the column names, the badge and the dialog name in zh-CN', async () => {
      await act(async () => { await i18n.changeLanguage('zh-CN'); });
      render(
        <SessionContext.Provider value={session}>
          <AccountsModal onClose={onClose} setToast={setToast} />
        </SessionContext.Provider>
      );
      const table = await screen.findByRole('table');
      expect(within(table).getAllByRole('columnheader')[0].textContent).toBe('名称');
      expect(within(table).getByText('本人')).toBeTruthy();
      expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(i18n.t('session:accounts.title'));
    });
  });
});

// The same window for the Windows app (no password, nobody is "you") and for a browser while the server
// remembers the owner's password.
describe('AccountsModal by mode', () => {
  let routes;
  let fetchMock;
  let setToast;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const ORIGINALS = 'Open and download original files';
  const PLACES = 'See places and filter by place';
  const ON = 'Account turned on';
  const PASSWORD = 'Your current password';
  const AGAIN = 'Enter your password again to confirm.';

  const renderModal = async ({ mode, session = { ...SESSION, signOut: vi.fn(), refresh: vi.fn() } } = {}) => {
    render(
      <SessionContext.Provider value={session}>
        <AccountsModal mode={mode} onClose={vi.fn()} setToast={setToast} />
      </SessionContext.Provider>
    );
    await screen.findByRole('table', { name: 'Accounts' });
  };

  const switchOf = (label, name) => screen.getByRole('switch', { name: `${label} for ${name}` });
  const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  const pick = (name, item) => {
    openMenu(name);
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
  };
  const stepDialog = (title) => screen.findByRole('dialog', { name: title });
  const submitStep = (name) => fireEvent.click(within(screen.getByRole('dialog', { name: /^(?!Accounts$)/ })).getByRole('button', { name }));
  const rowOf = (name) => screen.getByText(name, { selector: 'span.truncate' }).closest('[role="row"]');

  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  describe('on the desktop', () => {
    const DESKTOP = { ...LIST, you: null, confirm_remembered_s: 0, limits: { ...LIST.limits, confirm_remember_s: 0 } };

    beforeEach(() => {
      routes['GET /sharing/accounts'] = () => reply(DESKTOP);
    });

    it('reads /sharing/accounts, shows nobody as "you" and has no password field in the add card', async () => {
      await renderModal({ mode: 'desktop' });
      expect(requests('GET /sharing/accounts')).toHaveLength(1);
      expect(requests('GET /server/accounts')).toHaveLength(0);
      expect(screen.queryByText('you')).toBeNull();

      routes['POST /sharing/accounts'] = () => reply(DESKTOP);
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
      const card = screen.getByRole('form', { name: 'New account' });
      expect(within(card).queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'dave' } });
      fireEvent.change(within(card).getByLabelText('Password'), { target: { value: 'pass-word-1' } });
      fireEvent.change(within(card).getByLabelText('Repeat the password'), { target: { value: 'pass-word-1' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Owner' }));
      expect(within(card).queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.click(within(card).getByRole('button', { name: 'Add account' }));
      await waitFor(() => expect(requests('POST /sharing/accounts')).toHaveLength(1));
      expect(requests('POST /sharing/accounts')[0].body).toEqual({ name: 'dave', role: 'owner', password: 'pass-word-1' });
    });

    it('switches a permission on at once, with no step and no password', async () => {
      routes['POST /sharing/accounts/v1'] = () => reply(DESKTOP);
      await renderModal({ mode: 'desktop' });
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      await waitFor(() => expect(requests('POST /sharing/accounts/v1')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/v1')[0].body).toEqual({ permissions: { originals: true } });
      expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull();
    });

    it('turns an account on at once, a viewer and an owner alike', async () => {
      const off = { ...DESKTOP, accounts: DESKTOP.accounts.map((a) => (a.id === 'o2' ? { ...a, disabled: true } : a)) };
      routes['GET /sharing/accounts'] = () => reply(off);
      routes['POST /sharing/accounts/v2'] = () => reply(off);
      routes['POST /sharing/accounts/o2'] = () => reply(off);
      await renderModal({ mode: 'desktop' });
      fireEvent.click(switchOf(ON, 'carol'));
      await waitFor(() => expect(requests('POST /sharing/accounts/v2')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/v2')[0].body).toEqual({ disabled: false });
      fireEvent.click(switchOf(ON, 'olivia'));
      await waitFor(() => expect(requests('POST /sharing/accounts/o2')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/o2')[0].body).toEqual({ disabled: false });
      expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull();
    });

    it('rename confirms without a password field and sends only the name', async () => {
      routes['POST /sharing/accounts/v1'] = () => reply(DESKTOP);
      await renderModal({ mode: 'desktop' });
      pick('bob', 'Rename');
      await stepDialog('Rename bob');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'robert' } });
      submitStep('Rename');
      await waitFor(() => expect(requests('POST /sharing/accounts/v1')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/v1')[0].body).toEqual({ name: 'robert' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename bob' })).toBeNull());
    });

    it('change role, delete and turning an owner off confirm without a password field', async () => {
      routes['POST /sharing/accounts/v1'] = () => reply(DESKTOP);
      routes['POST /sharing/accounts/o2'] = () => reply(DESKTOP);
      routes['POST /sharing/accounts/v1/delete'] = () => reply({ ...DESKTOP, accounts: DESKTOP.accounts.filter((a) => a.id !== 'v1') });
      await renderModal({ mode: 'desktop' });

      pick('bob', 'Change role');
      await stepDialog('Make bob an owner?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      submitStep('Make owner');
      await waitFor(() => expect(requests('POST /sharing/accounts/v1')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/v1')[0].body).toEqual({ role: 'owner' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Make bob an owner?' })).toBeNull());

      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn off olivia?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      submitStep('Turn off');
      await waitFor(() => expect(requests('POST /sharing/accounts/o2')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/o2')[0].body).toEqual({ disabled: true });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn off olivia?' })).toBeNull());

      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      submitStep('Delete account');
      await waitFor(() => expect(requests('POST /sharing/accounts/v1/delete')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/v1/delete')[0].init).toEqual({ method: 'POST' });
      await waitFor(() => expect(screen.queryByText('bob', { selector: 'span.truncate' })).toBeNull());
    });

    it('set password asks for the new password twice and no current one', async () => {
      routes['POST /sharing/accounts/v1/password'] = () => reply(DESKTOP);
      await renderModal({ mode: 'desktop' });
      pick('bob', 'Set password');
      await stepDialog('Set a password for bob');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
      fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: 'new-password-1' } });
      submitStep('Set password');
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'The password of bob was set.', type: 'success' }));
      expect(requests('POST /sharing/accounts/v1/password')[0].body).toEqual({ new_password: 'new-password-1' });
    });

    it('still checks the new password in the set-password step', async () => {
      await renderModal({ mode: 'desktop' });
      pick('bob', 'Set password');
      await stepDialog('Set a password for bob');
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
      fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: 'other-password' } });
      submitStep('Set password');
      expect((await screen.findByRole('alert')).textContent).toBe('The two new passwords do not match.');
      expect(requests('POST /sharing/accounts/v1/password')).toHaveLength(0);
    });

    it('lets every owner row, the last one too, be deleted, turned off and demoted', async () => {
      const onlyOwner = { ...DESKTOP, accounts: [DESKTOP.accounts[0]] };
      routes['GET /sharing/accounts'] = () => reply(onlyOwner);
      routes['POST /sharing/accounts/a1'] = () => reply(onlyOwner);
      routes['POST /sharing/accounts/a1/delete'] = () => reply({ ...onlyOwner, accounts: [] });
      await renderModal({ mode: 'desktop' });
      expect(switchOf(ON, 'alice').disabled).toBe(false);
      openMenu('alice');
      for (const name of ['Rename', 'Change role', 'Set password', 'Sign out everywhere', 'Delete']) {
        const item = screen.getByRole('menuitem', { name });
        expect(item.disabled).toBe(false);
        expect(item.getAttribute('title')).toBeNull();
      }
      fireEvent.click(screen.getByRole('menuitem', { name: 'Change role' }));
      await stepDialog('Make alice a viewer?');
      submitStep('Make viewer');
      await waitFor(() => expect(requests('POST /sharing/accounts/a1')).toHaveLength(1));
      expect(requests('POST /sharing/accounts/a1')[0].body).toEqual({ role: 'viewer' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Make alice a viewer?' })).toBeNull());

      fireEvent.click(switchOf(ON, 'alice'));
      await stepDialog('Turn off alice?');
      submitStep('Turn off');
      await waitFor(() => expect(requests('POST /sharing/accounts/a1')).toHaveLength(2));
      expect(requests('POST /sharing/accounts/a1')[1].body).toEqual({ disabled: true });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn off alice?' })).toBeNull());

      pick('alice', 'Delete');
      await stepDialog('Delete alice?');
      submitStep('Delete account');
      await waitFor(() => expect(requests('POST /sharing/accounts/a1/delete')).toHaveLength(1));
    });

    it('defaults to the session mode when no mode is given', async () => {
      await renderModal({ session: { ...SESSION, mode: 'desktop', signOut: vi.fn(), refresh: vi.fn() } });
      expect(requests('GET /sharing/accounts')).toHaveLength(1);
    });
  });

  describe('in a browser while the server remembers the password', () => {
    const REMEMBERED = { ...LIST, confirm_remembered_s: 300, limits: { ...LIST.limits, confirm_remember_s: 300 } };

    beforeEach(() => {
      routes['GET /server/accounts'] = () => reply(REMEMBERED);
    });

    it('switches a permission on and turns a viewer on at once, with no password', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply(REMEMBERED);
      routes['PATCH /server/accounts/v2'] = () => reply(REMEMBERED);
      await renderModal({ mode: 'network' });
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v1')[0].body).toEqual({ permissions: { originals: true } });
      fireEvent.click(switchOf(ON, 'carol'));
      await waitFor(() => expect(requests('PATCH /server/accounts/v2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v2')[0].body).toEqual({ disabled: false });
      expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull();
    });

    it('confirms a rename of another account without the field and sends no password', async () => {
      routes['PATCH /server/accounts/o2'] = () => reply(REMEMBERED);
      await renderModal({ mode: 'network' });
      pick('olivia', 'Rename');
      await stepDialog('Rename olivia');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'olive' } });
      submitStep('Rename');
      await waitFor(() => expect(requests('PATCH /server/accounts/o2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/o2')[0].body).toEqual({ name: 'olive' });
    });

    it('does not ask again for another owner turned off or demoted, nor for a viewer password or a delete', async () => {
      routes['PATCH /server/accounts/o2'] = () => reply(REMEMBERED);
      routes['POST /server/accounts/v1/password'] = () => reply(REMEMBERED);
      routes['POST /server/accounts/v1/delete'] = () => reply(REMEMBERED);
      await renderModal({ mode: 'network' });

      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn off olivia?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      submitStep('Turn off');
      await waitFor(() => expect(requests('PATCH /server/accounts/o2')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/o2')[0].body).toEqual({ disabled: true });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn off olivia?' })).toBeNull());

      pick('olivia', 'Change role');
      await stepDialog('Make olivia a viewer?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      pick('bob', 'Set password');
      await stepDialog('Set a password for bob');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
      fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: 'new-password-1' } });
      submitStep('Set password');
      await waitFor(() => expect(requests('POST /server/accounts/v1/password')).toHaveLength(1));
      expect(requests('POST /server/accounts/v1/password')[0].body).toEqual({ new_password: 'new-password-1' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set a password for bob' })).toBeNull());

      pick('bob', 'Delete');
      await stepDialog('Delete bob?');
      expect(screen.queryByLabelText(PASSWORD)).toBeNull();
      submitStep('Delete account');
      await waitFor(() => expect(requests('POST /server/accounts/v1/delete')).toHaveLength(1));
      expect(requests('POST /server/accounts/v1/delete')[0].body).toEqual({});
    });

    it('still asks for the password to promote a viewer', async () => {
      routes['PATCH /server/accounts/v1'] = () => reply(REMEMBERED);
      await renderModal({ mode: 'network' });
      pick('bob', 'Change role');
      await stepDialog('Make bob an owner?');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
      expect(screen.queryByText(AGAIN)).toBeNull();
      fireEvent.change(screen.getByLabelText(PASSWORD), { target: { value: 'mine-1234' } });
      submitStep('Make owner');
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(1));
      expect(requests('PATCH /server/accounts/v1')[0].body).toEqual({ role: 'owner', current_password: 'mine-1234' });
    });

    it('still asks for the password to set an owner password, and to change your own account', async () => {
      await renderModal({ mode: 'network' });
      pick('olivia', 'Set password');
      await stepDialog('Set a password for olivia');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      pick('alice', 'Rename');
      await stepDialog('Rename alice');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      pick('alice', 'Set password');
      await stepDialog('Set a password for alice');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
    });

    it('still asks for the password to turn a turned-off owner back on', async () => {
      const off = { ...REMEMBERED, accounts: REMEMBERED.accounts.map((a) => (a.id === 'o2' ? { ...a, disabled: true } : a)) };
      routes['GET /server/accounts'] = () => reply(off);
      await renderModal({ mode: 'network' });
      fireEvent.click(switchOf(ON, 'olivia'));
      await stepDialog('Turn on olivia?');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
      expect(requests('PATCH /server/accounts/o2')).toHaveLength(0);
    });

    it('adds a viewer without the field, but an owner with it', async () => {
      routes['POST /server/accounts'] = () => reply(REMEMBERED);
      await renderModal({ mode: 'network' });
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
      const card = screen.getByRole('form', { name: 'New account' });
      expect(within(card).queryByLabelText(PASSWORD)).toBeNull();
      fireEvent.click(within(card).getByRole('button', { name: 'Owner' }));
      expect(within(card).getByLabelText(PASSWORD)).toBeTruthy();
      fireEvent.click(within(card).getByRole('button', { name: 'Viewer' }));
      expect(within(card).queryByLabelText(PASSWORD)).toBeNull();

      fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'dave' } });
      fireEvent.change(within(card).getByLabelText('Password'), { target: { value: 'pass-word-1' } });
      fireEvent.change(within(card).getByLabelText('Repeat the password'), { target: { value: 'pass-word-1' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Add account' }));
      await waitFor(() => expect(requests('POST /server/accounts')).toHaveLength(1));
      expect(requests('POST /server/accounts')[0].body).toEqual({
        name: 'dave',
        role: 'viewer',
        password: 'pass-word-1',
        permissions: { originals: false, image_search: true, places: true },
      });
    });

    it('re-opens a grant with the field and a line when the server asks for the password after all', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('confirm_password', 'Enter your password', 403);
      await renderModal({ mode: 'network' });
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      const dialog = await stepDialog('Let bob open and download original files?');
      expect(within(dialog).getByText(AGAIN)).toBeTruthy();
      expect(within(dialog).getByLabelText(PASSWORD)).toBeTruthy();
      expect(within(rowOf('bob')).queryByRole('alert')).toBeNull();
      expect(requests('PATCH /server/accounts/v1')[0].body).toEqual({ permissions: { originals: true } });

      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      fireEvent.change(within(dialog).getByLabelText(PASSWORD), { target: { value: 'mine-1234' } });
      submitStep('Allow');
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(2));
      expect(requests('PATCH /server/accounts/v1')[1].body).toEqual({ permissions: { originals: true }, current_password: 'mine-1234' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Let bob open and download original files?' })).toBeNull());
    });

    it('forgets the memory after that, so the next grant shows the step at once', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('confirm_password', 'Enter your password', 403);
      await renderModal({ mode: 'network' });
      fireEvent.click(switchOf(ORIGINALS, 'bob'));
      await stepDialog('Let bob open and download original files?');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /^(?!Accounts$)/ })).toBeNull());

      // carol has places off, so switching it on is a grant.
      fireEvent.click(switchOf(PLACES, 'carol'));
      const dialog = await stepDialog('Let carol see places and filter by place?');
      expect(within(dialog).getByLabelText(PASSWORD)).toBeTruthy();
      expect(within(dialog).queryByText(AGAIN)).toBeNull();
      expect(requests('PATCH /server/accounts/v2')).toHaveLength(0);
    });

    it('re-opens a rename step with the field and keeps the name that was typed', async () => {
      routes['PATCH /server/accounts/v1'] = refusal('confirm_password', 'Enter your password', 403);
      await renderModal({ mode: 'network' });
      pick('bob', 'Rename');
      const dialog = await stepDialog('Rename bob');
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'robert' } });
      submitStep('Rename');
      expect(await within(dialog).findByText(AGAIN)).toBeTruthy();
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect(screen.getByLabelText('New name').value).toBe('robert');

      routes['PATCH /server/accounts/v1'] = () => reply(LIST);
      fireEvent.change(within(dialog).getByLabelText(PASSWORD), { target: { value: 'mine-1234' } });
      submitStep('Rename');
      await waitFor(() => expect(requests('PATCH /server/accounts/v1')).toHaveLength(2));
      expect(requests('PATCH /server/accounts/v1')[1].body).toEqual({ name: 'robert', current_password: 'mine-1234' });
    });

    it('re-opens the add card with the field when the server asks for the password', async () => {
      routes['POST /server/accounts'] = refusal('confirm_password', 'Enter your password', 403);
      await renderModal({ mode: 'network' });
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
      const card = screen.getByRole('form', { name: 'New account' });
      fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'dave' } });
      fireEvent.change(within(card).getByLabelText('Password'), { target: { value: 'pass-word-1' } });
      fireEvent.change(within(card).getByLabelText('Repeat the password'), { target: { value: 'pass-word-1' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Add account' }));
      expect(await within(card).findByText(AGAIN)).toBeTruthy();
      expect(within(card).getByLabelText(PASSWORD)).toBeTruthy();
      expect(within(card).queryByRole('alert')).toBeNull();

      routes['POST /server/accounts'] = () => reply(LIST);
      fireEvent.change(within(card).getByLabelText(PASSWORD), { target: { value: 'mine-1234' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Add account' }));
      await waitFor(() => expect(requests('POST /server/accounts')).toHaveLength(2));
      expect(requests('POST /server/accounts')[1].body.current_password).toBe('mine-1234');
    });

    it('a memory that has run out behaves as before', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      try {
        await renderModal({ mode: 'network' });
        vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
        fireEvent.click(switchOf(ORIGINALS, 'bob'));
        const dialog = await stepDialog('Let bob open and download original files?');
        expect(within(dialog).getByLabelText(PASSWORD)).toBeTruthy();
        expect(within(dialog).queryByText(AGAIN)).toBeNull();
        expect(requests('PATCH /server/accounts/v1')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('in a browser while nothing is remembered', () => {
    it('keeps the password field in every step and in the add card', async () => {
      routes['GET /server/accounts'] = () => reply(LIST);
      await renderModal({ mode: 'network' });
      pick('bob', 'Rename');
      await stepDialog('Rename bob');
      expect(screen.getByLabelText(PASSWORD)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
      expect(within(screen.getByRole('form', { name: 'New account' })).getByLabelText(PASSWORD)).toBeTruthy();
    });
  });
});
