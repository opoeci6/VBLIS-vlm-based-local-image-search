import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1', embedding: [1, 0] },
    { path: '/photos/dog.jpg', media_type: 'image', score: 0.8, hash: 'h2', embedding: [0, 1] },
  ],
};

const json = (body) => ({ ok: true, json: async () => body });

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

  it('opens settings from the model pill', async () => {
    render(<App />);
    await screen.findByText('Ready to Search');
    fireEvent.click(screen.getAllByTitle(/Active Vision Engine: org\/model-a/)[0]);
    expect(await screen.findByText('Settings')).toBeTruthy();
  });
});
