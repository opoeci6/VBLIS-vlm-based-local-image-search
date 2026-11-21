import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { SessionProvider } from './session/SessionProvider';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

// Replica mode: the library is a read-only copy of an index made on another computer. The backend refuses every
// change to the index, so the app must not offer them (and must say so when one is still tried).

const defaultStatus = {
  is_indexing: false,
  percent: 0,
  progress: '0/0',
  total_files: 0,
  indexed_files: 0,
  current_file: '',
  errors: 0,
  failed_files: [],
  last_task_id: 0,
  is_downloading: false,
  download_total_bytes: 0,
  download_current_bytes: 0,
  download_speed: 0,
  download_eta: 0,
  download_error: null,
  cancel_download: false,
  is_loading_model: false,
  discovered_video_count: 0,
  indexed_video_frames: 0,
  is_rebuilding_video_thumbnails: false,
  rebuilt_video_frames: 0,
  total_video_frames_to_rebuild: 0,
};

const REPLICA = {
  source_host: 'PC-1',
  exported_at: '2026-11-20T12:00:00+00:00',
  imported_at: '2026-11-21T12:00:00+00:00',
  model_id: 'org/model-a',
  missing: 2,
};

const modelsPayload = {
  active_model: 'org/model-a',
  models: [{ id: 'org/model-a', downloaded: true }, { id: 'org/model-b', downloaded: true }],
};

const queuePayload = {
  active_task: null,
  pending_tasks: [],
  history: [
    { id: 'h1', type: 'INDEX_FOLDERS', title: 'Index: photos', status: 'completed', processed_count: 3, total_count: 3, completed_at: 1, created_at: 1 },
    { id: 'h2', type: 'REBUILD_VIDEO_THUMBNAILS', title: 'Rebuild Video Thumbnails', status: 'completed', processed_count: 1, total_count: 1, completed_at: 1, created_at: 1 },
  ],
  worker_state: 'running',
  pending_count: 0,
  history_count: 2,
  model_mismatch: null,
  active_model: 'org/model-a',
};

const gpuPayload = {
  use_gpu: false, cuda_available: false, device: 'cpu', batch_size: 0, effective_batch_size: 16,
  precision_mode: 'auto', active_precision: 'fp32', fp16_supported: false, gpu_name: '',
};

const foldersPayload = {
  folders: [{ path: '/photos', name: 'photos', exists: true, image_count: 3, video_count: 0, subfolder_count: 0, subfolders: [] }],
};

const optionsPayload = {
  total_files: 10, with_details: 4, unavailable: 0, missing_details: 6, media_types: { image: 10, video: 0 },
  formats: [{ id: 'jpeg', label: 'JPEG', media_type: 'image', count: 10 }], years: [], date_range: null, registry_available: true,
};

const sessionInfo = (role, extra = {}) => ({
  signed_in: true,
  role,
  account: { id: role === 'owner' ? 'o1' : 'v1', name: role === 'owner' ? 'alice' : 'bob' },
  permissions: { originals: role === 'owner', image_search: true, places: true },
  channel: 'network',
  secure: true,
  case_sensitive_paths: true,
  path_separator: '/',
  read_only: false,
  replica: null,
  ...extra,
});

const json = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });

const NOTICE = /Read-only copy of the library on PC-1, exported Nov \d\d, 2026\. Indexing happens on that computer: export again there and import here to update\./;

describe('App on a read-only copy of an index', () => {
  let fetchMock;
  let calls;
  let status;
  let refuseWith;

  const renderDesktop = () => render(<App />);
  const renderBrowser = (info) => render(
    <SessionProvider info={info} onSignOut={vi.fn()}>
      <App />
    </SessionProvider>
  );

  const openSettings = async () => {
    fireEvent.click(screen.getAllByTitle(/Active Vision Engine: org\/model-a/)[0]);
    return screen.findByText('Settings');
  };

  const openFolders = async () => {
    fireEvent.click(screen.getByText('Indexed Folders'));
    await screen.findByText('photos');
  };

  const openFilters = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Search filters/ }));
    return screen.findByRole('dialog', { name: 'Search filters' });
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.electronAPI;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', window.matchMedia);
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    calls = [];
    status = { ...defaultStatus, replica: REPLICA };
    refuseWith = null;

    fetchMock = vi.fn(async (url, init) => {
      const { pathname } = new URL(String(url));
      const method = init?.method || 'GET';
      const key = `${method} ${pathname}`;
      calls.push(key);
      if (refuseWith && key === refuseWith) {
        return { ok: false, status: 409, json: async () => ({ detail: 'This library is a read-only copy.', code: 'read_only' }) };
      }
      if (key === 'GET /models') return json(modelsPayload);
      if (key === 'GET /status') return json(status);
      if (key === 'GET /settings/gpu') return json(gpuPayload);
      if (key === 'GET /queue') return json(queuePayload);
      if (key === 'GET /index/folders') return json(foldersPayload);
      if (key === 'GET /search/filter-options') return json(optionsPayload);
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
    delete window.matchMedia;
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  describe('in the Windows app (status.replica)', () => {
    it('shows the notice with the host, the date and the missing files, and no way to add folders', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      const notice = await screen.findByTestId('replica-notice');
      expect(notice.textContent).toMatch(NOTICE);
      expect(notice.textContent).toContain("2 files of the copy aren't on this computer.");
      expect(screen.queryByText('Add Folder(s)')).toBeNull();
    });

    it('keeps browsing, and hides selecting, re-syncing and deleting folders', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      await openFolders();
      expect(screen.getByTitle('View media gallery & contents')).toBeTruthy();
      expect(screen.queryByText('Select All')).toBeNull();
      expect(screen.queryByTitle('Select folder and subfolders')).toBeNull();
      expect(screen.queryByTitle('Re-sync entire folder tree')).toBeNull();
      expect(screen.queryByTitle('Delete entire folder tree from index')).toBeNull();
    });

    it('hides Clear Indexed Database and the other models in the settings, and shows the notice there', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      await openSettings();

      // The model pill opens the Models group.
      expect(screen.getByText('This copy can only use its own model.')).toBeTruthy();
      expect(screen.getAllByText('model-a').length).toBeGreaterThan(0);
      expect(screen.queryByText('model-b')).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
      expect(screen.getAllByTestId('replica-notice').length).toBe(2);
      expect(screen.queryByText('Clear Indexed Database')).toBeNull();
      // Image cache and video thumbnails are not part of the index: still there.
      expect(screen.getByText('Thumbnail Cache Management')).toBeTruthy();
    });

    it('does not offer to also delete the index with the copy\'s own model', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      await openSettings();
      fireEvent.click(screen.getByTitle('Delete local files'));
      expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    });

    it('hides "Read details now" in the filters panel and never starts a details scan', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      const dialog = await openFilters();
      await waitFor(() => expect(calls).toContain('GET /search/filter-options'));
      await within(dialog).findByTestId('filters-coverage');
      expect(within(dialog).queryByRole('button', { name: 'Read details now' })).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).not.toContain('POST /index/media-info/scan');
    });

    it('gives indexing tasks in the history no Retry button, and keeps it for the others', async () => {
      renderDesktop();
      await screen.findByText('Ready to Search');
      fireEvent.click(await screen.findByTitle('Open Background Task Queue'));
      const dialogTitle = await screen.findByText('Index: photos');
      expect(dialogTitle).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    });

    it('leaves an ordinary library unchanged', async () => {
      status = defaultStatus;
      renderDesktop();
      await screen.findByText('Ready to Search');
      expect(screen.queryByTestId('replica-notice')).toBeNull();
      expect(screen.getByText('Add Folder(s)')).toBeTruthy();
      await openFolders();
      expect(screen.getByText('Select All')).toBeTruthy();
      expect(screen.getByTitle('Re-sync entire folder tree')).toBeTruthy();
      await openSettings();
      expect(screen.getByText('model-b')).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
      expect(screen.getByText('Clear Indexed Database')).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Models and GPU' }));
      // The control for the tests above: deleting a model offers the checkbox that wipes its index too.
      fireEvent.click(screen.getAllByTitle('Delete local files')[0]);
      expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    it('starts the details scan by itself in an ordinary library whose options report missing details', async () => {
      status = defaultStatus;
      renderDesktop();
      await screen.findByText('Ready to Search');
      await openFilters();
      await waitFor(() => expect(calls).toContain('POST /index/media-info/scan'));
    });

    it('words the notice without the missing files, and without a host', async () => {
      status = { ...defaultStatus, replica: { ...REPLICA, source_host: null, missing: 0 } };
      renderDesktop();
      const notice = await screen.findByTestId('replica-notice');
      expect(notice.textContent).toMatch(/^Read-only copy of the library on another computer, exported Nov \d\d, 2026\./);
      expect(notice.textContent).not.toContain('files of the copy');
    });

    it('says "1 file" for one missing file, and says nothing when the count is unknown', async () => {
      status = { ...defaultStatus, replica: { ...REPLICA, missing: 1 } };
      renderDesktop();
      expect((await screen.findByTestId('replica-notice')).textContent).toContain("1 file of the copy isn't on this computer.");
      cleanup();
      status = { ...defaultStatus, replica: { ...REPLICA, missing: null } };
      renderDesktop();
      expect((await screen.findByTestId('replica-notice')).textContent).not.toContain('of the copy');
    });

    it('tells a refused clear to the user when an old tab still sends it', async () => {
      status = defaultStatus;
      refuseWith = 'POST /index/clear';
      // An ordinary library whose backend turned into a copy meanwhile: the status poll has not caught up yet.
      renderDesktop();
      await screen.findByText('Ready to Search');
      await openSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
      fireEvent.click(screen.getByText('Clear Indexed Database'));
      fireEvent.click(await screen.findByText('Yes, Delete'));
      expect(await screen.findByText('This library is a read-only copy; indexing happens on another computer.')).toBeTruthy();
    });

    it('offers a drop for image search only, not for indexing folders', async () => {
      const { container } = renderDesktop();
      await screen.findByText('Ready to Search');
      await screen.findByTestId('replica-notice');
      fireEvent.dragOver(container.firstChild, { dataTransfer: { types: ['Files'], files: [] } });
      expect(await screen.findByText('Drop an image to search')).toBeTruthy();
      expect(screen.queryByText('Drop to search or index')).toBeNull();
    });

    it('makes no React commits while idle when the status carries the same replica', async () => {
      let commits = 0;
      render(
        <Profiler id="app" onRender={() => { commits += 1; }}>
          <App />
        </Profiler>
      );
      await screen.findByTestId('replica-notice');
      await screen.findByText('Ready to Search');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      commits = 0;
      const statusCallsBefore = calls.filter((key) => key === 'GET /status').length;
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(calls.filter((key) => key === 'GET /status').length - statusCallsBefore).toBeGreaterThanOrEqual(2);
      expect(commits).toBe(0);
    }, 20000);
  });

  describe('in a browser', () => {
    it('shows the notice to the owner and hides the same things', async () => {
      renderBrowser(sessionInfo('owner', { read_only: true, replica: REPLICA }));
      await screen.findByText('Ready to Search');
      expect((await screen.findByTestId('replica-notice')).textContent).toMatch(NOTICE);
      expect(screen.queryByText('Add Folder(s)')).toBeNull();
      await openFolders();
      expect(screen.queryByText('Select All')).toBeNull();
      expect(screen.queryByTitle('Re-sync entire folder tree')).toBeNull();
      expect(screen.queryByTitle('Delete entire folder tree from index')).toBeNull();
    });

    it('hides Clear Indexed Database and the other models from the owner in the settings', async () => {
      status = defaultStatus;
      renderBrowser(sessionInfo('owner', { read_only: true, replica: REPLICA }));
      await screen.findByText('Ready to Search');
      await openSettings();
      expect(screen.queryByText('Clear Indexed Database')).toBeNull();
      expect(screen.queryByText('model-b')).toBeNull();
      expect(screen.getByText('This copy can only use its own model.')).toBeTruthy();
    });

    it('does not start the details scan on its own, though the options report missing details', async () => {
      renderBrowser(sessionInfo('owner', { read_only: true, replica: REPLICA }));
      await screen.findByText('Ready to Search');
      await openFilters();
      await waitFor(() => expect(calls).toContain('GET /search/filter-options'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).not.toContain('POST /index/media-info/scan');
    });

    it('shows a viewer no notice, and nothing that a viewer did not have', async () => {
      status = defaultStatus;
      renderBrowser(sessionInfo('viewer', { read_only: true }));
      await screen.findByText('Ready to Search');
      expect(screen.queryByTestId('replica-notice')).toBeNull();
      expect(screen.queryByText('Add Folder(s)')).toBeNull();
      expect(screen.queryByTitle('Open Background Task Queue')).toBeNull();
      await openFolders();
      expect(screen.getByTitle('View media gallery & contents')).toBeTruthy();
      expect(screen.queryByText('Select All')).toBeNull();
    });

    it('leaves an ordinary library of an owner unchanged', async () => {
      status = defaultStatus;
      renderBrowser(sessionInfo('owner'));
      await screen.findByText('Ready to Search');
      expect(screen.queryByTestId('replica-notice')).toBeNull();
      expect(screen.getByText('Add Folder(s)')).toBeTruthy();
    });
  });
});
