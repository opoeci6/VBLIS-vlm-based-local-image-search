import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { resetEscapeKeyForTests, useEscapeKey } from '../../hooks/useEscapeKey';
import { FolderPickerModal } from './FolderPickerModal';

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) });

const ROOTS = {
  roots: [
    { path: '/lib/photos', name: 'photos', available: true },
    { path: '/lib/usb', name: 'usb', available: false },
  ],
};

const LISTINGS = {
  '/lib/photos': {
    path: '/lib/photos', root: '/lib/photos', parent: null, indexed: true,
    folders: [
      { name: '2023', path: '/lib/photos/2023', indexed: true },
      { name: 'trips', path: '/lib/photos/trips', indexed: false },
    ],
    skipped: 0, truncated: false,
  },
  '/lib/photos/trips': {
    path: '/lib/photos/trips', root: '/lib/photos', parent: '/lib/photos', indexed: false,
    folders: [{ name: 'italy', path: '/lib/photos/trips/italy', indexed: false }],
    skipped: 0, truncated: false,
  },
  '/lib/photos/2023': {
    path: '/lib/photos/2023', root: '/lib/photos', parent: '/lib/photos', indexed: true,
    folders: [], skipped: 0, truncated: false,
  },
};

describe('FolderPickerModal', () => {
  let routes;
  let fetchMock;
  let onClose;
  let onConfirm;

  const renderPicker = (props = {}) => render(
    <FolderPickerModal uiTheme="modern" onClose={onClose} onConfirm={onConfirm} {...props} />
  );

  beforeEach(() => {
    onClose = vi.fn();
    onConfirm = vi.fn().mockResolvedValue({ tasks: [] });
    routes = {
      '/fs/roots': () => reply(ROOTS),
      '/fs/list': (path) => (LISTINGS[path] ? reply(LISTINGS[path]) : reply({ detail: 'Folder not found' }, 404)),
    };
    fetchMock = vi.fn(async (url) => {
      const parsed = new URL(String(url));
      const handler = routes[parsed.pathname];
      if (!handler) throw new Error(`unexpected ${parsed.pathname}`);
      return handler(parsed.searchParams.get('path'));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the library folders and dims one that is unavailable', async () => {
    renderPicker();
    expect(await screen.findByRole('button', { name: 'Open photos' })).toBeTruthy();
    const usb = screen.getByRole('button', { name: 'Open usb' });
    expect(usb.disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Select usb' }).disabled).toBe(true);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(usb.closest('[title]').getAttribute('title')).toBe("This folder isn't available on the server right now.");
    fireEvent.click(usb);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens a folder, marks the indexed ones and shows the breadcrumb', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    expect(await screen.findByRole('button', { name: 'Open trips' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open 2023' })).toBeTruthy();
    // The current folder and 2023 are indexed, trips is not.
    expect(screen.getAllByText('Indexed')).toHaveLength(2);
    expect(screen.getByRole('navigation').textContent).toContain('photos');

    fireEvent.click(screen.getByRole('button', { name: 'Open trips' }));
    expect(await screen.findByRole('button', { name: 'Open italy' })).toBeTruthy();
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('photos');
    expect(nav.textContent).toContain('trips');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `http://127.0.0.1:8000/fs/list?path=${encodeURIComponent('/lib/photos/trips')}`
    );
  });

  it('goes up to the parent, then to the library folders from a root', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open trips' }));
    await screen.findByRole('button', { name: 'Open italy' });

    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    expect(await screen.findByRole('button', { name: 'Open 2023' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open italy' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    expect(await screen.findByRole('button', { name: 'Open usb' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Up' }).disabled).toBe(true);
  });

  it('jumps back with a breadcrumb entry', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open trips' }));
    await screen.findByRole('button', { name: 'Open italy' });

    const nav = screen.getByRole('navigation');
    fireEvent.click(Array.from(nav.querySelectorAll('button')).find((b) => b.textContent === 'photos'));
    expect(await screen.findByRole('button', { name: 'Open 2023' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Library folders' }));
    expect(await screen.findByRole('button', { name: 'Open usb' })).toBeTruthy();
  });

  it('adds the ticked folders, across folders and including the current one', async () => {
    renderPicker();
    const add = () => screen.getByRole('button', { name: /^Add \d+ folders?$/ });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select photos' }));
    expect(add().textContent).toBe('Add 1 folder');

    fireEvent.click(screen.getByRole('button', { name: 'Open photos' }));
    await screen.findByRole('button', { name: 'Open trips' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select 2023' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open trips' }));
    await screen.findByRole('button', { name: 'Open italy' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add this folder' }));
    expect(add().textContent).toBe('Add 3 folders');

    fireEvent.click(add());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(['/lib/photos', '/lib/photos/2023', '/lib/photos/trips']);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('unticks a folder again and disables Add with nothing ticked', async () => {
    renderPicker();
    const add = await screen.findByRole('button', { name: /^Add 0 folders$/ });
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select photos' }));
    expect(screen.getByRole('button', { name: 'Add 1 folder' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deselect photos' }));
    expect(screen.getByRole('button', { name: 'Add 0 folders' }).disabled).toBe(true);
  });

  it('stays open when nothing was queued', async () => {
    onConfirm.mockResolvedValue(null);
    renderPicker();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select photos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 folder' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains how to add library folders when there are none', async () => {
    routes['/fs/roots'] = () => reply({ roots: [] });
    renderPicker();
    expect(await screen.findByText('No library folders on the server yet')).toBeTruthy();
    const code = document.querySelector('code');
    expect(code.textContent).toBe('add-library-folder');
    expect(screen.getByRole('button', { name: /^Add 0 folders$/ }).disabled).toBe(true);
  });

  it('notes a truncated listing and names that were skipped', async () => {
    routes['/fs/list'] = () => reply({ ...LISTINGS['/lib/photos'], truncated: true, skipped: 2 });
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    expect(await screen.findByText('Only the first folders are shown. Open a subfolder to see more.')).toBeTruthy();
    expect(screen.getByText("2 folder names couldn't be shown.")).toBeTruthy();
  });

  it('says when a folder has no subfolders', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open 2023' }));
    expect(await screen.findByText('No subfolders here.')).toBeTruthy();
  });

  it('shows the server detail when a folder cannot be read, and can go back', async () => {
    routes['/fs/list'] = () => reply({ detail: 'Not a library folder' }, 403);
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not a library folder');
    fireEvent.click(screen.getByRole('button', { name: 'Library folders' }));
    expect(await screen.findByRole('button', { name: 'Open usb' })).toBeTruthy();
  });

  it('shows a fallback message when the server cannot be reached', async () => {
    routes['/fs/roots'] = () => { throw new TypeError('offline'); };
    renderPicker();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read this folder.');
  });

  it('closes with Escape, the close button, Cancel and a backdrop click', async () => {
    renderPicker();
    await screen.findByRole('button', { name: 'Open photos' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('keeps Windows paths intact in the breadcrumb', async () => {
    routes['/fs/roots'] = () => reply({ roots: [{ path: 'D:\\Photos', name: 'Photos', available: true }] });
    routes['/fs/list'] = () => reply({
      path: 'D:\\Photos\\Trips', root: 'D:\\Photos', parent: 'D:\\Photos', indexed: false, folders: [], skipped: 0, truncated: false,
    });
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Photos' }));
    await screen.findByText('No subfolders here.');
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('Trips');
    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url)))).toContain('http://127.0.0.1:8000/fs/list?path=D:\\Photos'));
  });

  it('keeps the non-local view unchanged when local is false and kind is library', async () => {
    routes['/fs/roots'] = () => reply({
      local: false,
      roots: [{ path: '/lib/photos', name: 'photos', kind: 'library', available: true }],
    });
    renderPicker();
    expect(await screen.findByRole('dialog', { name: 'Add folders from the server' })).toBeTruthy();
    expect(screen.getByText('Choose folders on the server to add to the library.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Library folders' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open photos' })).toBeTruthy();
  });

  it('shows local title, labels by kind, and path lines when on this computer', async () => {
    routes['/fs/roots'] = () => reply({
      local: true,
      roots: [
        { path: '/Users/alice', name: 'alice', kind: 'home', available: true },
        { path: '/Volumes/USB', name: 'USB', kind: 'volume', available: true },
        { path: '/', name: '/', kind: 'disk', available: true },
        { path: '/srv/shared', name: 'shared', kind: 'library', available: true },
      ],
    });
    routes['/fs/list'] = (path) => {
      if (path === '/Users/alice') {
        return reply({
          path: '/Users/alice',
          root: '/Users/alice',
          parent: null,
          indexed: false,
          folders: [{ name: 'Pictures', path: '/Users/alice/Pictures', indexed: false }],
          skipped: 0,
          truncated: false,
        });
      }
      if (path === '/Users/alice/Pictures') {
        return reply({
          path: '/Users/alice/Pictures',
          root: '/Users/alice',
          parent: '/Users/alice',
          indexed: false,
          folders: [],
          skipped: 0,
          truncated: false,
        });
      }
      return reply({
        path: '/',
        root: '/',
        parent: null,
        indexed: false,
        folders: [],
        skipped: 0,
        truncated: false,
      });
    };

    renderPicker();
    expect(await screen.findByRole('dialog', { name: 'Add folders from this computer' })).toBeTruthy();
    expect(screen.getByText('Choose folders on this computer to add to the library.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'This computer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'This computer' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Open Home folder' })).toBeTruthy();
    expect(screen.getByText('/Users/alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open USB' })).toBeTruthy();
    expect(screen.getByText('/Volumes/USB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Entire disk' })).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open shared' })).toBeTruthy();
    expect(screen.getByText('/srv/shared')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Home folder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Pictures' }));
    await screen.findByText('No subfolders here.');
    expect(screen.getByRole('navigation').textContent).toContain('Home folder');
    expect(screen.getByRole('navigation').textContent).toContain('Pictures');

    fireEvent.click(screen.getByRole('button', { name: 'This computer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Entire disk' }));
    await screen.findByText('No subfolders here.');
    expect(screen.getByRole('navigation').textContent).toContain('Entire disk');
  });

  it('shows friendly messages for macos_privacy and no_permission error codes', async () => {
    routes['/fs/list'] = () => reply({ detail: 'Raw detail', code: 'macos_privacy' }, 403);
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/macOS didn't let VBLIS read this folder/);

    routes['/fs/list'] = () => reply({ detail: 'Raw detail', code: 'no_permission' }, 403);
    fireEvent.click(screen.getByRole('button', { name: 'Library folders' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
    expect((await screen.findByRole('alert')).textContent).toBe("The server isn't allowed to read this folder.");
  });

  describe('opened by dropping folders onto the page', () => {
    it('names the dropped folders and keeps the note while browsing', async () => {
      renderPicker({ droppedNames: ['Trip 2024', 'photos'] });
      const note = await screen.findByRole('note');
      expect(note.textContent).toBe(
        "You dropped “Trip 2024” and “photos”. A browser doesn't tell VBLIS where a dropped folder is, so find it below and tick it.",
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Open photos' }));
      await screen.findByText('Add this folder');
      expect(screen.getByRole('note')).toBe(note);
    });

    it('explains without names when the browser gave none, or more than three', async () => {
      const generic = "A browser doesn't tell VBLIS where a dropped folder is, so find it below and tick it.";
      renderPicker({ droppedNames: [] });
      expect((await screen.findByRole('note')).textContent).toBe(generic);
      cleanup();
      renderPicker({ droppedNames: ['a', 'b', 'c', 'd'] });
      expect((await screen.findByRole('note')).textContent).toBe(generic);
    });

    it('shows no note when opened with the Add Folder(s) button', async () => {
      renderPicker();
      await screen.findByRole('button', { name: 'Open photos' });
      expect(screen.queryByRole('note')).toBeNull();
    });
  });
});

// jsdom runs history traversals asynchronously and fires popstate, like a browser: wait for them to land.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const back = async () => {
  await act(async () => { window.history.back(); });
  await settle();
};

describe('FolderPickerModal on a phone', () => {
  let pushState;
  let go;

  beforeEach(() => {
    window.history.replaceState(null, '');
    pushState = vi.spyOn(window.history, 'pushState');
    go = vi.spyOn(window.history, 'go');
  });

  afterEach(async () => {
    cleanup();
    await settle();
    resetBackToCloseForTests();
    resetEscapeKeyForTests();
    setNetworkModeForTests(false);
    vi.restoreAllMocks();
    window.history.replaceState(null, '');
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ roots: [] }) })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('makes no history calls outside network mode', async () => {
    render(<FolderPickerModal onClose={vi.fn()} onConfirm={vi.fn()} />);
    await settle();
    expect(pushState).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('pushes one history entry and closes with Back in network mode', async () => {
    setNetworkModeForTests(true);
    const onClose = vi.fn();
    render(<FolderPickerModal onClose={onClose} onConfirm={vi.fn()} />);
    await settle();
    expect(pushState).toHaveBeenCalledTimes(1);
    await back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Esc to a view above it', async () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    const Above = () => {
      useEscapeKey(true, onEscape);
      return null;
    };
    render(<><FolderPickerModal onClose={onClose} onConfirm={vi.fn()} /><Above /></>);
    await settle();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
