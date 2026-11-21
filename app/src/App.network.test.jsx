import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import TitleBar from './TitleBar';
import { FolderContentsModal } from './components/folders/FolderContentsModal';
import { SessionProvider } from './session/SessionProvider';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

const defaultStatus = {
  is_indexing: false,
  percent: 0,
  progress: '0/0',
  total_files: 0,
  indexed_files: 0,
  last_task_id: 0,
  errors: 0,
  is_downloading: false,
  download_total_bytes: 0,
  download_current_bytes: 0,
  download_speed: 0,
  download_eta: 0,
  cancel_download: false,
  is_loading_model: false,
  discovered_video_count: 0,
  indexed_video_frames: 0,
  is_rebuilding_video_thumbnails: false,
  rebuilt_video_frames: 0,
  total_video_frames_to_rebuild: 0,
};

const modelsPayload = { active_model: 'org/model-a', models: [{ id: 'org/model-a', downloaded: true }] };

const queuePayload = {
  active_task: null,
  pending_tasks: [],
  history: [],
  worker_state: 'running',
  pending_count: 0,
  history_count: 0,
  model_mismatch: null,
  active_model: 'org/model-a',
};

const gpuPayload = {
  use_gpu: false,
  cuda_available: false,
  device: 'cpu',
  batch_size: 0,
  effective_batch_size: 16,
  precision_mode: 'auto',
  active_precision: 'fp32',
  fp16_supported: false,
  gpu_name: '',
};

const foldersPayload = {
  folders: [{ path: '/photos', name: 'photos', exists: true, image_count: 3, video_count: 0, subfolder_count: 0, subfolders: [] }],
};

const searchPayload = { results: [{ path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1' }] };

const sessionInfo = (role, permissions = {}) => ({
  signed_in: true,
  role,
  account: { id: role === 'owner' ? 'o1' : 'v1', name: role === 'owner' ? 'alice' : 'bob' },
  permissions: { originals: role === 'owner', image_search: true, places: true, ...permissions },
  channel: 'network',
  secure: true,
  case_sensitive_paths: true,
  path_separator: '/',
});

// What a viewer may call, from the server's contract. Anything else is a violation.
const VIEWER_ROUTES = new Set([
  'POST /search',
  'POST /search/image',
  'POST /search/ref',
  'POST /search/video',
  'POST /browse',
  'POST /video/frames/batch-extract',
  'GET /search/filter-options',
  'GET /image',
  'GET /index/folders',
  'GET /index/folder/contents',
  'GET /status',
  'GET /models',
  'POST /auth/password',
]);

// The owner's view of the accounts (GET /server/accounts).
const accountsPayload = {
  accounts: [
    { id: 'o1', name: 'alice', role: 'owner', permissions: { originals: true, image_search: true, places: true }, disabled: false },
    { id: 'v1', name: 'bob', role: 'viewer', permissions: { originals: false, image_search: true, places: true }, disabled: false },
    { id: 'v2', name: 'carol', role: 'viewer', permissions: { originals: true, image_search: false, places: false }, disabled: true },
  ],
  you: 'o1',
  limits: { max_accounts: 50, name_max: 32, password_min: 8, password_max: 256 },
};

const json = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Account and appearance' }));

const openSettings = (container) => fireEvent.click(container.querySelector('header button.hover\\:rotate-45'));

describe('App in a browser', () => {
  let fetchMock;
  let violations;
  let calls;
  let status;
  let models;
  let enforceViewerRoutes;

  // The filter options report files without media details, which makes the app start a details scan.
  const withMissingDetails = () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/search/filter-options') {
        calls.push('GET /search/filter-options');
        return json({ total_files: 10, with_details: 2, missing_details: 8, formats: [], years: [], folders: [], places: [] });
      }
      return original(url, init);
    });
  };

  // The filter options of a library that has place data.
  const withPlaceData = () => {
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/search/filter-options') {
        calls.push('GET /search/filter-options');
        return json({ total_files: 10, with_details: 10, missing_details: 0, formats: [], years: [], folders: [], places_available: true, with_gps: 4, places: [] });
      }
      return original(url, init);
    });
  };

  const renderApp = (info, props = {}) => {
    const onSignOut = vi.fn();
    const view = render(
      <SessionProvider info={info} onSignOut={onSignOut}>
        <App {...props} />
      </SessionProvider>
    );
    return { ...view, onSignOut };
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.electronAPI;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    violations = [];
    calls = [];
    status = defaultStatus;
    models = modelsPayload;
    enforceViewerRoutes = false;

    fetchMock = vi.fn(async (url, init) => {
      const { pathname } = new URL(String(url));
      const key = `${init?.method || 'GET'} ${pathname}`;
      calls.push(key);
      if (enforceViewerRoutes && !VIEWER_ROUTES.has(key)) {
        violations.push(key);
        return { ok: false, status: 403, json: async () => ({ detail: 'Not allowed' }) };
      }
      if (key === 'GET /models') return json(models);
      if (key === 'GET /status') return json(status);
      if (key === 'GET /settings/gpu') return json(gpuPayload);
      if (key === 'GET /queue') return json(queuePayload);
      if (key === 'GET /index/folders') return json(foldersPayload);
      if (key === 'POST /search' || key === 'POST /search/image') return json(searchPayload);
      if (key === 'GET /server/settings') return json({ accounts: { owners: 1, viewers: 2 }, library_roots: [], port: 8000, tls_mode: 'off', public_access: false, from_environment: [] });
      if (key === 'GET /server/accounts') return json(accountsPayload);
      if (key === 'GET /image/cache/stats') {
        return json({
          images: { count: 0, bytes: 0, formatted: '0 B' },
          videos: { count: 0, bytes: 0, formatted: '0 B' },
          total: { count: 0, bytes: 0, formatted: '0 B' },
        });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.electronAPI;
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  describe('as a viewer', () => {
    const viewer = (permissions) => sessionInfo('viewer', permissions);

    beforeEach(() => { enforceViewerRoutes = true; });

    it('never calls an owner-only route, however much of the app is used', async () => {
      const { container } = renderApp(viewer());
      await screen.findByText('Ready to Search');

      // Use everything a viewer can reach: the folder list, search, settings, the filter panel.
      fireEvent.click(screen.getByText('Indexed Folders'));
      await screen.findByText('photos');
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(1));
      openSettings(container);
      await screen.findByText('Settings');
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      await waitFor(() => expect(calls).toContain('GET /search/filter-options'));

      // Both pollers run every 1.2 to 1.5 seconds.
      await new Promise((resolve) => setTimeout(resolve, 1800));

      expect(violations).toEqual([]);
      expect(calls).toContain('GET /status');
      expect(calls).toContain('GET /models');
      expect(calls).not.toContain('GET /queue');
      expect(calls).not.toContain('GET /settings/gpu');
      expect(calls).not.toContain('GET /image/cache/stats');
    });

    it('does not start the automatic media details scan', async () => {
      withMissingDetails();
      renderApp(viewer());
      await screen.findByText('Ready to Search');
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      await waitFor(() => expect(calls).toContain('GET /search/filter-options'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(violations).toEqual([]);
      expect(calls).not.toContain('POST /index/media-info/scan');
    });

    it('shows the Place filter only with the places permission', async () => {
      withPlaceData();
      const first = renderApp(viewer({ places: false }));
      await screen.findByText('Ready to Search');
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      await screen.findByRole('dialog', { name: 'Search filters' });
      await waitFor(() => expect(calls).toContain('GET /search/filter-options'));
      await screen.findByRole('region', { name: 'Format' });
      expect(screen.queryByRole('region', { name: 'Place' })).toBeNull();
      first.unmount();

      renderApp(viewer({ places: true }));
      await screen.findByText('Ready to Search');
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      expect(await screen.findByRole('region', { name: 'Place' })).toBeTruthy();
      expect(violations).toEqual([]);
    });

    it('searches with a chosen picture through the search bar button, using only viewer routes', async () => {
      renderApp(viewer({ image_search: true }));
      await screen.findByText('Ready to Search');
      expect(screen.getByRole('button', { name: 'Search with a picture' })).toBeTruthy();
      fireEvent.change(screen.getByTestId('picture-input'), { target: { files: [new File(['x'], 'cat.png', { type: 'image/png' })] } });
      await waitFor(() => expect(calls).toContain('POST /search/image'));
      expect(violations).toEqual([]);
    });

    it('has no picture button without the permission, and no Server section in the settings', async () => {
      const { container } = renderApp(viewer({ image_search: false }));
      await screen.findByText('Ready to Search');
      expect(screen.queryByRole('button', { name: 'Search with a picture' })).toBeNull();
      openSettings(container);
      await screen.findByText('Settings');
      expect(screen.queryByRole('tab', { name: 'Server' })).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: 'Your account' }));
      expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
      expect(screen.queryByText('Server')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Manage accounts' })).toBeNull();
      expect(calls).not.toContain('GET /server/settings');
      expect(violations).toEqual([]);
    });

    it('changes its own password from the settings', async () => {
      const { container } = renderApp(viewer());
      await screen.findByText('Ready to Search');
      openSettings(container);
      fireEvent.click(await screen.findByRole('tab', { name: 'Your account' }));
      await screen.findByRole('heading', { name: 'Your account' });
      fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
      fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: 'new-password-1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
      await waitFor(() => expect(calls).toContain('POST /auth/password'));
      expect(violations).toEqual([]);
    });

    it('warns about plain HTTP, with the viewer text, and never touches owner routes', async () => {
      renderApp({ ...viewer(), secure: false });
      expect(await screen.findByText(/This connection isn't encrypted\. Others on this network/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /How to turn on HTTPS/ }));
      expect(screen.getByText("Ask the server's owner to turn on HTTPS.")).toBeTruthy();
      expect(violations).toEqual([]);
    });

    it('hides the queue, folder management, owner settings and the model actions', async () => {
      const { container } = renderApp(viewer());
      await screen.findByText('Ready to Search');

      expect(screen.queryByTitle('Open Background Task Queue')).toBeNull();
      expect(screen.queryByText('Add Folder(s)')).toBeNull();
      expect(screen.queryByTitle('Unload model to free GPU VRAM')).toBeNull();

      fireEvent.click(screen.getByText('Indexed Folders'));
      await screen.findByText('photos');
      expect(screen.getByTitle('View media gallery & contents')).toBeTruthy();
      expect(screen.queryByText('Select All')).toBeNull();
      expect(screen.queryByTitle('Select folder and subfolders')).toBeNull();
      expect(screen.queryByTitle('Re-sync entire folder tree')).toBeNull();
      expect(screen.queryByTitle('Delete entire folder tree from index')).toBeNull();

      openSettings(container);
      await screen.findByText('Settings');
      expect(screen.getByText('UI Theme Style')).toBeTruthy();
      expect(screen.getByText('Language')).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
      expect(screen.getByText('Minimum Match Score')).toBeTruthy();
      // A viewer has no Models and GPU or Library group at all.
      expect(screen.queryByRole('tab', { name: 'Models and GPU' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
      expect(screen.queryByText('Model Management')).toBeNull();
      expect(screen.queryByText('Hardware Acceleration & Batching')).toBeNull();
      expect(screen.queryByText('Thumbnail Cache Management')).toBeNull();
      expect(screen.queryByText('Clear Indexed Database')).toBeNull();
    });

    it('shows indexing progress without the pause, cancel and queue controls', async () => {
      status = { ...defaultStatus, is_indexing: true, percent: 40, progress: '4/10', total_files: 10 };
      renderApp(viewer());
      expect(await screen.findByText('40%')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Pause$/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Cancel$/ })).toBeNull();
      expect(screen.queryByText('View in Queue')).toBeNull();
    });

    it('says the owner has not set up a model, with nothing to download or activate', async () => {
      models = { active_model: '', models: [{ id: 'org/model-a', downloaded: true }] };
      renderApp(viewer());
      expect(await screen.findByText("The owner hasn't set up a model yet")).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Activate/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    });

    it('hides the ghost record cleanup in the folder contents', () => {
      const props = {
        showFolderContents: true,
        browsingFolder: { path: '/photos', name: 'photos' },
        folderContents: { items: [], image_count: 1, video_count: 0, indexed_count: 0, unindexed_count: 0, missing_on_disk_count: 2, total_count: 1 },
        isFetchingFolderContents: false,
        isCleaningGhostRecords: false,
        setIsCleaningGhostRecords: vi.fn(),
        folderVisibleLimit: 60,
        setFolderVisibleLimit: vi.fn(),
        handleCloseFolderContents: vi.fn(),
        handleReindexFolder: vi.fn(),
        setSelectedImage: vi.fn(),
        setToast: vi.fn(),
        uiTheme: 'modern',
      };
      const { unmount } = render(<FolderContentsModal {...props} />);
      expect(screen.getByText('Clean Ghost Records')).toBeTruthy();
      unmount();

      render(<SessionProvider info={viewer()} onSignOut={vi.fn()}><FolderContentsModal {...props} /></SessionProvider>);
      expect(screen.getByText('2 missing from disk')).toBeTruthy();
      expect(screen.queryByText('Clean Ghost Records')).toBeNull();
    });

    it('shows the role and signs out from the header menu', async () => {
      const { onSignOut } = renderApp(viewer());
      await screen.findByText('Ready to Search');
      openMenu();
      expect(screen.getByText('Signed in as bob · Viewer')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });

    it('offers the image drop only with the image search permission', async () => {
      const dragOver = (element) => fireEvent.dragOver(element, { dataTransfer: { types: ['Files'], files: [] } });

      const first = renderApp(viewer({ image_search: true }));
      await screen.findByText('Ready to Search');
      dragOver(first.container.firstChild);
      expect(await screen.findByText('Drop an image to search')).toBeTruthy();
      expect(screen.queryByText('Drop to search or index')).toBeNull();
      first.unmount();

      const second = renderApp(viewer({ image_search: false }));
      await screen.findByText('Ready to Search');
      dragOver(second.container.firstChild);
      expect(screen.queryByText('Drop an image to search')).toBeNull();
    });
  });

  describe('as the owner', () => {
    it('keeps the management controls but no Explorer or window buttons', async () => {
      const { container } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');

      expect(screen.getByTitle('Open Background Task Queue')).toBeTruthy();
      expect(screen.getByText('Add Folder(s)')).toBeTruthy();
      openMenu();
      expect(screen.getByText('Signed in as alice · Owner')).toBeTruthy();
      expect(screen.queryByTitle('Minimize')).toBeNull();
      expect(screen.queryByTitle('Maximize')).toBeNull();
      expect(screen.queryByText('Show in Explorer')).toBeNull();

      fireEvent.click(screen.getByText('Indexed Folders'));
      await screen.findByText('photos');
      expect(screen.getByText('Select All')).toBeTruthy();
      expect(screen.getByTitle('Re-sync entire folder tree')).toBeTruthy();
      expect(screen.getByTitle('Delete entire folder tree from index')).toBeTruthy();

      openSettings(container);
      await screen.findByText('Settings');
      fireEvent.click(screen.getByRole('tab', { name: 'Models and GPU' }));
      expect(screen.getByText('Model Management')).toBeTruthy();
      expect(screen.getByText('Hardware Acceleration & Batching')).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
      expect(screen.getByText('Clear Indexed Database')).toBeTruthy();

      expect(calls).toContain('GET /queue');
      expect(calls).toContain('GET /settings/gpu');
    });

    it('starts the automatic media details scan when files lack details', async () => {
      withMissingDetails();
      renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
      await waitFor(() => expect(calls).toContain('POST /index/media-info/scan'));
    });

    it('has the Server section in the settings, with the accounts window', async () => {
      const { container } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      openSettings(container);
      expect(screen.getByRole('tab', { name: 'Your account' })).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Server' }));
      expect(await screen.findByText('1 owner, 2 viewers')).toBeTruthy();
      expect(calls).toContain('GET /server/settings');

      fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }));
      const dialog = await screen.findByRole('dialog', { name: 'Accounts' });
      expect(await within(dialog).findByText('bob')).toBeTruthy();
      expect(within(dialog).getByText('you')).toBeTruthy();
      expect(within(dialog).getByRole('switch', { name: 'See places and filter by place for bob' }).getAttribute('aria-checked')).toBe('true');
      expect(calls).toContain('GET /server/accounts');
    });

    it('opens the server folder picker from Add Folder(s) instead of the Electron dialog', async () => {
      renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      fireEvent.click(screen.getByText('Add Folder(s)'));
      expect(await screen.findByRole('dialog', { name: 'Add folders from the server' })).toBeTruthy();
      expect(calls).toContain('GET /fs/roots');
    });

    it('offers image search by drop and says folders cannot be dropped', async () => {
      const { container } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      fireEvent.dragOver(container.firstChild, { dataTransfer: { types: ['Files'], files: [] } });
      expect(await screen.findByText('Drop an image to search')).toBeTruthy();

      fireEvent.drop(container.firstChild, { dataTransfer: { types: ['Files'], files: [{ name: 'photos', type: '' }] } });
      expect(await screen.findByText("Folders can't be dropped into a browser. Use the Add Folder(s) button instead.")).toBeTruthy();
    });
  });

  describe('without a title bar', () => {
    it('renders no title bar and no room for one, with the account in the header menu', async () => {
      const { container } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      expect(screen.queryByTestId('title-bar')).toBeNull();
      expect(container.firstChild.className).not.toContain('pt-8');
      expect(container.firstChild.className).toContain('pt-safe');
      // The menu button shows the account name next to the icon (hidden below sm by CSS).
      expect(within(screen.getByRole('button', { name: 'Account and appearance' })).getByText('alice')).toBeTruthy();
      expect(screen.queryByText('Signed in as alice · Owner')).toBeNull();
    });

    it('switches the style and light or dark from the header menu, closing it after each choice', async () => {
      const { container } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      expect(container.firstChild.className).toContain('theme-modern');

      openMenu();
      fireEvent.click(screen.getByRole('button', { name: /Retro Terminal/ }));
      expect(container.firstChild.className).toContain('theme-terminal');
      expect(screen.queryByText('Signed in as alice · Owner')).toBeNull();

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark Mode' }));
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(screen.queryByText('Signed in as alice · Owner')).toBeNull();

      openMenu();
      expect(screen.getByRole('button', { name: 'Switch to Light Mode' })).toBeTruthy();
    });

    it('signs out from the header menu and closes it', async () => {
      const { onSignOut } = renderApp(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Signed in as alice · Owner')).toBeNull();
    });
  });

  describe('on the desktop', () => {
    it('keeps the title bar and its top room, and has no header menu', async () => {
      const { container } = render(<App />);
      await screen.findByText('Ready to Search');
      expect(screen.getByTestId('title-bar')).toBeTruthy();
      expect(container.firstChild.className).toContain('pt-8');
      expect(screen.queryByRole('button', { name: 'Account and appearance' })).toBeNull();
    });

    it('keeps the window buttons and the Explorer controls', () => {
      window.electronAPI = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), openInExplorer: vi.fn() };
      render(<TitleBar theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={vi.fn()} />);
      fireEvent.click(screen.getByTitle('Minimize'));
      fireEvent.click(screen.getByTitle('Maximize'));
      fireEvent.click(screen.getByTitle('Close'));
      expect(window.electronAPI.minimize).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.maximize).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.close).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    it('has no Server section, picture button or HTTP banner', async () => {
      const { container } = render(<App />);
      await screen.findByText('Ready to Search');
      expect(screen.queryByRole('button', { name: 'Search with a picture' })).toBeNull();
      openSettings(container);
      await screen.findByText('Settings');
      expect(screen.queryByRole('tab', { name: 'Your account' })).toBeNull();
      // The desktop has its own Sharing group (with its own Manage accounts button), not the network's Server one.
      expect(screen.queryByRole('tab', { name: 'Server' })).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: 'Network sharing' }));
      expect(await screen.findByRole('heading', { name: 'Network sharing' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Server' })).toBeNull();
      expect(calls).not.toContain('GET /server/settings');
      expect(screen.queryByText(/isn't encrypted/)).toBeNull();
    });

    it('has no window buttons or sign-out in a plain page without a session', () => {
      render(<TitleBar theme="light" setTheme={vi.fn()} uiTheme="modern" setUiTheme={vi.fn()} />);
      expect(screen.queryByTitle('Minimize')).toBeNull();
      expect(screen.queryByTitle('Close')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });
  });
});
