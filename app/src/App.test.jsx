import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

const API = 'http://127.0.0.1:8000';

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

const modelsPayload = {
  active_model: 'org/model-a',
  models: [{ id: 'org/model-a', downloaded: true }],
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

const foldersPayload = {
  folders: [{
    path: '/photos', name: 'photos', exists: true, image_count: 3, video_count: 0, subfolder_count: 0, subfolders: [],
  }],
};

const searchPayload = {
  results: [
    { path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1' },
    { path: '/photos/dog.jpg', media_type: 'image', score: 0.8, hash: 'h2' },
  ],
};

// Fresh deep copy per call, like a real network response (a shared instance would hide re-render churn).
const json = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });

describe('App (smoke)', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', window.matchMedia);
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock = vi.fn(async (url, init) => {
      const { pathname } = new URL(String(url));
      const method = init?.method || 'GET';
      if (pathname === '/models' && method === 'GET') return json(modelsPayload);
      if (pathname === '/status') return json(defaultStatus);
      if (pathname === '/settings/gpu' && method === 'GET') return json(gpuPayload);
      if (pathname === '/queue') return json(queuePayload);
      if (pathname === '/index/folders') return json(foldersPayload);
      if (pathname === '/search' && method === 'POST') return json(searchPayload);
      if (pathname === '/image/cache/stats') {
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
    delete window.matchMedia;
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  it('boots to the Ready to Search state with the active model and no drag overlay', async () => {
    render(<App />);

    expect(await screen.findByText('Ready to Search')).toBeTruthy();
    expect(screen.getAllByText('model-a').length).toBeGreaterThan(0);
    expect(screen.getByText('Indexed Folders')).toBeTruthy();
    expect(screen.queryByText('Drop to search or index')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('shows the model setup state when no model is active', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/models' && (init?.method || 'GET') === 'GET') {
        return json({ active_model: '', models: [{ id: 'org/model-a', downloaded: true }] });
      }
      if (pathname === '/status') return json(defaultStatus);
      if (pathname === '/settings/gpu') return json(gpuPayload);
      if (pathname === '/queue') return json({ ...queuePayload, active_model: null });
      return json({});
    });
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Activate model-a' })).toBeTruthy();
    expect(screen.getAllByText('No Model Loaded').length).toBeGreaterThan(0);
  });

  it('searches and renders result cards', async () => {
    render(<App />);
    await screen.findByText('Ready to Search');

    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
    const searchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === `${API}/search` && init?.method === 'POST');
    expect(JSON.parse(searchCall[1].body)).toMatchObject({ query: 'cats', top_k: 50 });
    expect(screen.queryByText('Ready to Search')).toBeNull();
  });

  it('opens the lightbox when a result card is clicked and closes it again', async () => {
    render(<App />);
    await screen.findByText('Ready to Search');
    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const cards = await screen.findAllByAltText('Result');

    fireEvent.click(cards[0]);
    expect(await screen.findByText('Match Score: 91%')).toBeTruthy();
    expect(screen.getByAltText('Full size result').getAttribute('src')).toContain('size=full');

    fireEvent.click(screen.getByAltText('Full size result').closest('.fixed'));
    await waitFor(() => expect(screen.queryByText('Match Score: 91%')).toBeNull());
  });

  it('opens the settings modal from the header gear', async () => {
    const { container } = render(<App />);
    await screen.findByText('Ready to Search');

    fireEvent.click(container.querySelector('header button.hover\\:rotate-45'));
    expect(await screen.findByText('Settings')).toBeTruthy();
    expect(screen.getByTitle('Close settings')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Close settings'));
    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull());
  });

  it('switches to the terminal theme from the settings modal', async () => {
    const { container } = render(<App />);
    await screen.findByText('Ready to Search');
    expect(document.documentElement.getAttribute('data-theme-style')).toBe('modern');

    fireEvent.click(container.querySelector('header button.hover\\:rotate-45'));
    fireEvent.click(await screen.findByText('Retro Terminal'));

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme-style')).toBe('terminal'));
    expect(localStorage.getItem('ui_theme_style')).toBe('terminal');
  });

  it('re-runs the last text search with the same body after deleting an indexed folder', async () => {
    const defaultImpl = fetchMock.getMockImplementation();
    const searchBodies = [];
    const afterDeleteResults = { results: [searchPayload.results[0]] };
    fetchMock.mockImplementation(async (url, init) => {
      const { pathname } = new URL(String(url));
      const method = init?.method || 'GET';
      if (pathname === '/search' && method === 'POST') {
        searchBodies.push(init.body);
        return json(searchBodies.length === 1 ? searchPayload : afterDeleteResults);
      }
      if (pathname === '/index/folder/delete' && method === 'POST') return json({ status: 'ok' });
      return defaultImpl(url, init);
    });

    render(<App />);
    await screen.findByText('Ready to Search');
    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
    expect(searchBodies).toHaveLength(1);

    fireEvent.click(screen.getByTitle('Expand folders'));
    fireEvent.click(await screen.findByTitle('Delete entire folder tree from index'));

    await waitFor(() => expect(searchBodies).toHaveLength(2));
    expect(searchBodies[1]).toBe(searchBodies[0]);
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(1));
    expect(screen.queryByText('Ready to Search')).toBeNull();
    expect(screen.getByTitle('Collapse folders').getAttribute('aria-expanded')).toBe('true');
    const deleteCall = fetchMock.mock.calls.find(([url]) => String(url) === `${API}/index/folder/delete`);
    expect(JSON.parse(deleteCall[1].body)).toEqual({ folder_path: '/photos' });
  });

  describe('Find more frames', () => {
    const videoFrame = (i, score) => ({
      id: `clip-${i}`, path: '/videos/clip.mp4', media_type: 'video', score, timestamp_seconds: i * 10,
    });
    const videoSearchPayload = {
      results: [videoFrame(0, 0.9), videoFrame(1, 0.8)],
      query_ref: 'ref-1',
    };
    const videoFramesPayload = {
      path: '/videos/clip.mp4',
      frames: [0, 1, 2, 3, 4].map(i => videoFrame(i, 0.9 - i * 0.1)),
      total_frames: 5,
      query_ref: 'ref-1',
    };

    const searchForVideo = async () => {
      render(<App />);
      await screen.findByText('Ready to Search');
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      return screen.findByText('clip.mp4');
    };

    const mockVideoBackend = (videoResponse) => {
      const defaultImpl = fetchMock.getMockImplementation();
      const videoBodies = [];
      fetchMock.mockImplementation(async (url, init) => {
        const { pathname } = new URL(String(url));
        const method = init?.method || 'GET';
        if (pathname === '/search' && method === 'POST') return json(videoSearchPayload);
        if (pathname === '/search/video' && method === 'POST') {
          videoBodies.push(JSON.parse(init.body));
          return videoResponse();
        }
        return defaultImpl(url, init);
      });
      return videoBodies;
    };

    it('shows the merged frames in the open modal after expanding', async () => {
      const videoBodies = mockVideoBackend(() => json(videoFramesPayload));
      fireEvent.click(await searchForVideo());

      expect(await screen.findByText('2 RETURNED FRAMES')).toBeTruthy();
      expect(screen.getAllByText(/^FRAME \d+$/)).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: /Find more frames/ }));

      expect(await screen.findByText('5 MATCHING OF 5')).toBeTruthy();
      expect(screen.getAllByText(/^FRAME \d+$/)).toHaveLength(5);
      expect(screen.queryByRole('button', { name: /Find more frames|Finding frames/ })).toBeNull();
      expect(videoBodies).toEqual([{ query_ref: 'ref-1', path: '/videos/clip.mp4', min_score: 0.1, query: 'cats' }]);
    });

    it('keeps the modal open and the button usable after a failed expansion', async () => {
      mockVideoBackend(() => ({ ok: false, status: 410, json: async () => ({ detail: 'expired' }) }));
      fireEvent.click(await searchForVideo());
      fireEvent.click(await screen.findByRole('button', { name: /Find more frames/ }));

      expect(await screen.findByText('This search has expired. Please search again.')).toBeTruthy();
      expect(screen.getByText('2 RETURNED FRAMES')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Find more frames/ }).disabled).toBe(false);
    });

    it('closes the modal when a new search no longer contains the video', async () => {
      mockVideoBackend(() => json(videoFramesPayload));
      fireEvent.click(await searchForVideo());
      expect(await screen.findByText('2 RETURNED FRAMES')).toBeTruthy();

      const defaultImpl = fetchMock.getMockImplementation();
      fetchMock.mockImplementation(async (url, init) => {
        const { pathname } = new URL(String(url));
        if (pathname === '/search' && (init?.method || 'GET') === 'POST') return json(searchPayload);
        return defaultImpl(url, init);
      });
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'dogs' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
      expect(screen.queryByText('2 RETURNED FRAMES')).toBeNull();
      expect(screen.queryByLabelText('Close video results')).toBeNull();
    });
  });

  it('makes no React commits while idle with unchanged poll responses', async () => {
    let commits = 0;
    render(
      <Profiler id="app" onRender={() => { commits += 1; }}>
        <App />
      </Profiler>
    );
    await screen.findByText('Ready to Search');
    // Let the first full poll round (1.5 s interval) land so every state has settled.
    await new Promise(resolve => setTimeout(resolve, 2000));

    commits = 0;
    const statusCallsBefore = fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/status').length;
    await new Promise(resolve => setTimeout(resolve, 6000));
    const statusCallsAfter = fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/status').length;

    expect(statusCallsAfter - statusCallsBefore).toBeGreaterThanOrEqual(3);
    expect(commits).toBe(0);
  }, 20000);

  it('opens settings from the model pill', async () => {
    render(<App />);
    await screen.findByText('Ready to Search');
    fireEvent.click(screen.getAllByTitle(/Active Vision Engine: org\/model-a/)[0]);
    expect(await screen.findByText('Settings')).toBeTruthy();
  });
  describe('search filters', () => {
    const refPayload = {
      results: [{ path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1' }],
      query_ref: 'ref-2',
    };

    // Routes the search endpoints on top of the default mock and records every search request.
    const mockSearchBackend = ({ search = { ...searchPayload, query_ref: 'ref-1' }, ref = refPayload, image = { results: [], query_ref: 'img-ref' } } = {}) => {
      const defaultImpl = fetchMock.getMockImplementation();
      const calls = [];
      fetchMock.mockImplementation(async (url, init) => {
        const { pathname } = new URL(String(url));
        const method = init?.method || 'GET';
        if (method === 'POST' && ['/search', '/search/ref', '/search/image'].includes(pathname)) {
          calls.push({ pathname, body: pathname === '/search/image' ? init.body : JSON.parse(init.body) });
          return json(pathname === '/search' ? search : pathname === '/search/ref' ? ref : image);
        }
        return defaultImpl(url, init);
      });
      return calls;
    };

    const openFilters = async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Search filters/ }));
      return screen.findByRole('dialog', { name: 'Search filters' });
    };

    const searchFor = (text) => {
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    };

    const dropImage = (container) => {
      const file = new File(['x'], 'cat.png', { type: 'image/png' });
      // Outside Electron the dropped file's path comes from file.path.
      Object.defineProperty(file, 'path', { value: '/tmp/cat.png' });
      fireEvent.drop(container.firstChild, { dataTransfer: { files: [file], types: ['Files'] } });
    };

    it('sends the chosen filters with a search and lists them as chips', async () => {
      const calls = mockSearchBackend();
      render(<App />);
      await screen.findByText('Ready to Search');

      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Images' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Search filters (1 active)' })).toBeTruthy();
      expect(screen.getByText('Images only')).toBeTruthy();

      searchFor('cats');
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ query: 'cats', top_k: 50, min_score: 0.1, filters: { media_type: 'image' } });
    });

    it('re-runs the current search through the saved reference when a filter changes', async () => {
      const calls = mockSearchBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
      expect(calls[0].body).toEqual({ query: 'cats', top_k: 50, min_score: 0.1 });

      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Videos' }));

      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].pathname).toBe('/search/ref');
      expect(calls[1].body).toEqual({ query_ref: 'ref-1', top_k: 50, min_score: 0.1, filters: { media_type: 'video' } });
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(1));
    });

    it('removes a filter from its chip and re-runs the search without it', async () => {
      const calls = mockSearchBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Images' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      searchFor('cats');
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

      fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Images only' }));

      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].pathname).toBe('/search/ref');
      expect(Object.keys(calls[1].body)).toEqual(['query_ref', 'top_k', 'min_score']);
      expect(screen.queryByText('Images only')).toBeNull();
    });

    it('shows the no-matches state after an image search with no results', async () => {
      mockSearchBackend({ image: { results: [], query_ref: 'img-ref' } });
      const { container } = render(<App />);
      await screen.findByText('Ready to Search');

      dropImage(container);

      expect(await screen.findByText('No matches found')).toBeTruthy();
      expect(screen.queryByText('Ready to Search')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    });

    it('offers Clear filters when an image search finds nothing under the filters', async () => {
      const calls = mockSearchBackend({ image: { results: [], query_ref: 'img-ref' } });
      const { container } = render(<App />);
      await screen.findByText('Ready to Search');

      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Videos' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      dropImage(container);

      expect(await screen.findByText('No matches with the current filters')).toBeTruthy();
      expect(JSON.parse(calls[0].body.get('filters'))).toEqual({ media_type: 'video' });

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].pathname).toBe('/search/ref');
      expect(calls[1].body).toEqual({ query_ref: 'img-ref', top_k: 50, min_score: 0.7 });
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(1));
      expect(screen.queryByText('No matches with the current filters')).toBeNull();
    });

    it('shows the chips inside the results console in the terminal theme', async () => {
      localStorage.setItem('ui_theme_style', 'terminal');
      const calls = mockSearchBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Images' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      searchFor('cats');

      expect(await screen.findByText('Search Results')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Remove filter: Images only' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Images only' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].pathname).toBe('/search/ref');
    });

    it('opens the filters panel from the results console in the terminal theme', async () => {
      localStorage.setItem('ui_theme_style', 'terminal');
      mockSearchBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      expect(await screen.findByText('Search Results')).toBeTruthy();

      // The header button is covered by the console; use the console's own.
      const buttons = screen.getAllByRole('button', { name: 'Search filters' });
      expect(buttons).toHaveLength(2);
      const button = buttons[1];
      fireEvent.click(button);
      const dialog = await screen.findByRole('dialog', { name: 'Search filters' });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      // The panel stays open when the Filters button itself is pressed, and closes with it.
      fireEvent.mouseDown(button);
      expect(screen.getByRole('dialog', { name: 'Search filters' })).toBe(dialog);
      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
  describe('media details', () => {
    const scanTask = (extra = {}) => ({
      id: 'scan-1', type: 'SCAN_MEDIA_INFO', title: 'Read media details', status: 'running', progress: 10, processed_count: 1, total_count: 10, ...extra,
    });
    const optionsPayload = (extra = {}) => ({
      total_files: 10, with_details: 4, unavailable: 0, missing_details: 6, media_types: { image: 10, video: 0 },
      formats: [{ id: 'jpeg', label: 'JPEG', media_type: 'image', count: 10 }], years: [], date_range: null, registry_available: true, ...extra,
    });

    // Search, filter-options, scan and queue endpoints, with a queue the test can change.
    const mockDetailsBackend = ({ options = optionsPayload(), results = { ...searchPayload, query_ref: 'ref-1' } } = {}) => {
      const defaultImpl = fetchMock.getMockImplementation();
      const state = { options, activeTask: null, pendingTasks: [], searchCalls: [], scans: 0, results };
      fetchMock.mockImplementation(async (url, init) => {
        const { pathname } = new URL(String(url));
        const method = init?.method || 'GET';
        if (pathname === '/queue') {
          return json({ ...queuePayload, active_task: state.activeTask, pending_tasks: state.pendingTasks, pending_count: state.pendingTasks.length });
        }
        if (pathname === '/search/filter-options') return json(state.options);
        if (pathname === '/index/media-info/scan' && method === 'POST') {
          state.scans += 1;
          return json({ status: 'queued', task_id: 'scan-1' });
        }
        if (method === 'POST' && (pathname === '/search' || pathname === '/search/ref')) {
          state.searchCalls.push({ pathname, body: JSON.parse(init.body) });
          return json(state.results);
        }
        return defaultImpl(url, init);
      });
      return state;
    };

    const openFilters = async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Search filters/ }));
      return screen.findByRole('dialog', { name: 'Search filters' });
    };

    const searchFor = (text) => {
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    };

    it('starts reading the missing details when the options first show some, and says so', async () => {
      const state = mockDetailsBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      expect(state.scans).toBe(0);

      await openFilters();
      expect(await screen.findByText('Reading media details for 6 files in the background (no re-indexing needed)')).toBeTruthy();
      expect(state.scans).toBe(1);
    });

    it('does not start a scan when no file lacks details', async () => {
      const state = mockDetailsBackend({ options: optionsPayload({ with_details: 10, missing_details: 0 }) });
      render(<App />);
      await screen.findByText('Ready to Search');
      await openFilters();
      expect(await screen.findByText(/Media details for 10 of 10 files/)).toBeTruthy();
      expect(state.scans).toBe(0);
    });

    it('does not start a scan while one is already running', async () => {
      const state = mockDetailsBackend();
      state.activeTask = scanTask();
      render(<App />);
      await screen.findByText('Ready to Search');
      // Let the queue poll deliver the running scan before the panel opens.
      await new Promise(resolve => setTimeout(resolve, 1800));

      const dialog = await openFilters();
      expect(await within(dialog).findByText('Reading media details...')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Read details now' }).disabled).toBe(true);
      expect(state.scans).toBe(0);
    }, 15000);

    it('shows a waiting scan as in progress too', async () => {
      const state = mockDetailsBackend({ options: optionsPayload({ missing_details: 0, with_details: 10 }) });
      state.pendingTasks = [scanTask({ status: 'pending' })];
      render(<App />);
      await screen.findByText('Ready to Search');
      await new Promise(resolve => setTimeout(resolve, 1800));
      const dialog = await openFilters();
      expect(await within(dialog).findByText('Reading media details...')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Read details now' }).disabled).toBe(true);
    }, 15000);

    it('re-runs the search once when the scan finishes while a details filter is active', async () => {
      const state = mockDetailsBackend({ options: optionsPayload({ with_details: 10, missing_details: 0 }) });
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Portrait' }));
      await waitFor(() => expect(state.searchCalls).toHaveLength(2));
      expect(state.searchCalls[1].body.filters).toEqual({ orientations: ['portrait'] });

      state.activeTask = scanTask();
      expect(await within(dialog).findByText('Reading media details...', {}, { timeout: 4000 })).toBeTruthy();
      expect(state.searchCalls).toHaveLength(2);

      state.activeTask = null;
      await waitFor(() => expect(state.searchCalls).toHaveLength(3), { timeout: 5000 });
      expect(state.searchCalls[2].pathname).toBe('/search/ref');
      expect(state.searchCalls[2].body).toEqual(state.searchCalls[1].body);
      await waitFor(() => expect(within(dialog).queryByText('Reading media details...')).toBeNull());
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(state.searchCalls).toHaveLength(3);
    }, 20000);

    it('does not re-run the search when the scan finishes and only other filters are active', async () => {
      const state = mockDetailsBackend({ options: optionsPayload({ with_details: 10, missing_details: 0 }) });
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Images' }));
      await waitFor(() => expect(state.searchCalls).toHaveLength(2));

      state.activeTask = scanTask();
      expect(await within(dialog).findByText('Reading media details...', {}, { timeout: 4000 })).toBeTruthy();
      state.activeTask = null;
      await waitFor(() => expect(within(dialog).queryByText('Reading media details...')).toBeNull(), { timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 800));
      expect(state.searchCalls).toHaveLength(2);
    }, 20000);

    it('explains the empty result and offers to read the details when a details filter finds nothing', async () => {
      const state = mockDetailsBackend({ results: { results: [], query_ref: 'ref-1' } });
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      expect(await screen.findByText('No matches found')).toBeTruthy();

      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Portrait' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

      const hint = () => screen.findByTestId('no-matches-details-hint');
      expect(within(await hint()).getByText('6 files have no media details yet, so these filters skip them.')).toBeTruthy();
      expect(screen.getByText('No matches with the current filters')).toBeTruthy();
      // The panel already started the scan by itself when it first loaded the options.
      expect(state.scans).toBe(1);

      fireEvent.click(within(await hint()).getByRole('button', { name: 'Read details now' }));
      await waitFor(() => expect(state.scans).toBe(2));

      state.activeTask = scanTask();
      // Look the hint up again each time: the no-matches state is re-rendered while the scan starts.
      await waitFor(() => expect(within(screen.getByTestId('no-matches-details-hint')).getByText('Reading media details...')).toBeTruthy(), { timeout: 4000 });
      expect(within(screen.getByTestId('no-matches-details-hint')).queryByRole('button', { name: 'Read details now' })).toBeNull();
    }, 20000);

    it('leaves the details hint out when the active filters do not need details', async () => {
      mockDetailsBackend({ results: { results: [], query_ref: 'ref-1' } });
      render(<App />);
      await screen.findByText('Ready to Search');
      searchFor('cats');
      await screen.findByText('No matches found');
      const dialog = await openFilters();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Images' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(await screen.findByText('No matches with the current filters')).toBeTruthy();
      expect(screen.queryByTestId('no-matches-details-hint')).toBeNull();
    });
  });

  describe('browsing the library', () => {
    const libraryPayload = (extra = {}) => ({
      results: [
        { path: '/photos/new.jpg', media_type: 'image', score: null, score_kind: 'none', taken_at: '2024-05-01T10:00:00', hash: 'n1' },
        { path: '/photos/old.jpg', media_type: 'image', score: null, score_kind: 'none', taken_at: '2020-02-03T08:30:00', hash: 'o1' },
      ],
      total: 7,
      ...extra,
    });

    // Routes /browse on top of the default mock and records every browse request.
    const mockBrowseBackend = (payload = libraryPayload()) => {
      const defaultImpl = fetchMock.getMockImplementation();
      const calls = [];
      fetchMock.mockImplementation(async (url, init) => {
        const { pathname } = new URL(String(url));
        if (pathname === '/browse' && init?.method === 'POST') {
          const body = JSON.parse(init.body);
          calls.push(body);
          return json(typeof payload === 'function' ? payload(body) : payload);
        }
        return defaultImpl(url, init);
      });
      return calls;
    };

    const pressSearch = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const HINT = 'Currently browsing your library. Type a search to find something specific.';
    const clearButton = () => screen.queryByRole('button', { name: 'Clear search text' });

    it('shows the library for an empty Search, with the header, the hint and the date taken', async () => {
      const calls = mockBrowseBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      expect(screen.getByText('Press Search with an empty box to browse your library.')).toBeTruthy();
      expect(screen.queryByText(HINT)).toBeNull();

      pressSearch();

      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
      // The library ignores Max Results: no top_k.
      expect(calls).toEqual([{ sort: 'newest' }]);
      expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
      expect(screen.getByText('7 items')).toBeTruthy();
      expect(screen.queryByText(/Showing/)).toBeNull();
      // The hint sits under the Library header, not under the search box.
      const hint = screen.getByText(HINT);
      const heading = screen.getByRole('heading', { name: 'Library' });
      expect(heading.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(hint.closest('header')).toBeNull();
      expect(screen.queryByText('Ready to Search')).toBeNull();
      expect(screen.queryByText(/% Match/)).toBeNull();
    });

    it('treats a box with only spaces like an empty one', async () => {
      const calls = mockBrowseBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: '   ' } });
      fireEvent.submit(screen.getByPlaceholderText(/Search images/).closest('form'));
      await waitFor(() => expect(calls).toHaveLength(1));
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
    });

    it('re-runs the browse in the other order with the toggle', async () => {
      const calls = mockBrowseBackend((body) => libraryPayload({ results: body.sort === 'oldest' ? libraryPayload().results.slice().reverse() : libraryPayload().results }));
      render(<App />);
      await screen.findByText('Ready to Search');
      pressSearch();
      await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

      fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toEqual({ sort: 'oldest' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Oldest first' }).getAttribute('aria-pressed')).toBe('true'));
      expect(screen.getByText('7 items')).toBeTruthy();
    });

    it('hides the hint with its x and keeps it hidden until the next empty Search', async () => {
      const calls = mockBrowseBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      pressSearch();
      expect(await screen.findByText(HINT)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Close hint' }));
      expect(screen.queryByText(HINT)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Oldest first' }).getAttribute('aria-pressed')).toBe('true'));
      expect(screen.queryByText(HINT)).toBeNull();

      pressSearch();
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(await screen.findByText(HINT)).toBeTruthy();
    });

    it('ends the browse when a text search follows', async () => {
      mockBrowseBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      pressSearch();
      await screen.findByText(HINT);

      fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
      pressSearch();
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull());
      expect(screen.queryByText(HINT)).toBeNull();
      expect(screen.getAllByAltText('Result')).toHaveLength(2);
    });

    it('says there is nothing to browse yet for an empty library', async () => {
      mockBrowseBackend({ results: [], total: 0 });
      render(<App />);
      await screen.findByText('Ready to Search');
      pressSearch();
      expect(await screen.findByText('Nothing to browse yet: add a folder to index it.')).toBeTruthy();
      expect(screen.queryByText('Ready to Search')).toBeNull();
    });

    describe('the x in the search box', () => {
      it('is hidden with no text and no results', async () => {
        mockBrowseBackend();
        render(<App />);
        await screen.findByText('Ready to Search');
        expect(clearButton()).toBeNull();
      });

      it('with only text, clears the text and nothing else, and refocuses the box', async () => {
        mockBrowseBackend();
        render(<App />);
        await screen.findByText('Ready to Search');
        const input = screen.getByPlaceholderText(/Search images/);
        fireEvent.change(input, { target: { value: 'cats' } });
        fireEvent.click(clearButton());
        expect(input.value).toBe('');
        expect(document.activeElement).toBe(input);
        expect(screen.getByText('Ready to Search')).toBeTruthy();
        expect(clearButton()).toBeNull();
      });

      it('after a browse, clears the library and returns to the main page', async () => {
        mockBrowseBackend();
        render(<App />);
        await screen.findByText('Ready to Search');
        pressSearch();
        await screen.findByText(HINT);
        expect(screen.getByPlaceholderText(/Search images/).value).toBe('');
        expect(clearButton()).toBeTruthy();

        fireEvent.click(clearButton());

        expect(await screen.findByText('Ready to Search')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();
        expect(screen.queryByText(HINT)).toBeNull();
        expect(screen.queryAllByAltText('Result')).toHaveLength(0);
        expect(clearButton()).toBeNull();
        expect(document.activeElement).toBe(screen.getByPlaceholderText(/Search images/));
      });

      it('after a text search, clears the text and the results', async () => {
        mockBrowseBackend();
        render(<App />);
        await screen.findByText('Ready to Search');
        const input = screen.getByPlaceholderText(/Search images/);
        fireEvent.change(input, { target: { value: 'cats' } });
        pressSearch();
        await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

        fireEvent.click(clearButton());

        expect(await screen.findByText('Ready to Search')).toBeTruthy();
        expect(input.value).toBe('');
        expect(screen.queryAllByAltText('Result')).toHaveLength(0);
        expect(document.activeElement).toBe(input);
      });

      it('shows after a browse that came back empty and returns to the main page', async () => {
        mockBrowseBackend({ results: [], total: 0 });
        render(<App />);
        await screen.findByText('Ready to Search');
        pressSearch();
        expect(await screen.findByText('Nothing to browse yet: add a folder to index it.')).toBeTruthy();
        expect(clearButton()).toBeTruthy();

        fireEvent.click(clearButton());

        expect(await screen.findByText('Ready to Search')).toBeTruthy();
        expect(screen.queryByText('Nothing to browse yet: add a folder to index it.')).toBeNull();
        expect(clearButton()).toBeNull();
      });

      it('shows after a text search with no matches and returns to the main page', async () => {
        const defaultImpl = fetchMock.getMockImplementation();
        fetchMock.mockImplementation(async (url, init) => {
          if (new URL(String(url)).pathname === '/search' && init?.method === 'POST') return json({ results: [] });
          return defaultImpl(url, init);
        });
        render(<App />);
        await screen.findByText('Ready to Search');
        fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'unicorns' } });
        pressSearch();
        expect(await screen.findByText('No matches found')).toBeTruthy();

        fireEvent.click(clearButton());

        expect(await screen.findByText('Ready to Search')).toBeTruthy();
        expect(screen.queryByText('No matches found')).toBeNull();
      });
    });

    it('shows the library in the terminal console with its own toggle', async () => {
      localStorage.setItem('ui_theme_style', 'terminal');
      const calls = mockBrowseBackend();
      render(<App />);
      await screen.findByText('Ready to Search');
      pressSearch();

      expect(await screen.findByText('BROWSING · NEWEST FIRST')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
      expect(screen.getByText('7 ITEMS')).toBeTruthy();
      expect(screen.getByText(HINT)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].sort).toBe('oldest');
      expect(await screen.findByText('BROWSING · OLDEST FIRST')).toBeTruthy();
    });
  });
});
