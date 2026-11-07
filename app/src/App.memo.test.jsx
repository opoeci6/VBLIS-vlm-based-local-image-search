import { Profiler, memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

// Render-counting wrapper around the real (memoized) grid: the counter only moves when
// the grid actually re-renders, i.e. when App hands it changed props.
const gridRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./components/search/SearchResultsGrid', async (importOriginal) => {
  const original = await importOriginal();
  const RealGrid = original.SearchResultsGrid;
  const CountedGrid = memo(function CountedGrid(props) {
    gridRenders.count += 1;
    return <RealGrid {...props} />;
  });
  return { ...original, SearchResultsGrid: CountedGrid };
});

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

const modelsPayload = { active_model: 'org/model-a', models: [{ id: 'org/model-a', downloaded: true }] };

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
  folders: [{ path: '/photos', name: 'photos', exists: true, image_count: 3, video_count: 0, subfolder_count: 0, subfolders: [] }],
};

const searchPayload = {
  results: [
    { path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1', embedding: [1, 0] },
    { path: '/photos/dog.jpg', media_type: 'image', score: 0.8, hash: 'h2', embedding: [0, 1] },
  ],
};

// Fresh deep copy per call, like a real network response.
const json = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });

describe('App memoization', () => {
  let statusPayload;

  beforeEach(() => {
    gridRenders.count = 0;
    statusPayload = defaultStatus;
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', window.matchMedia);
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const { pathname } = new URL(String(url));
      const method = init?.method || 'GET';
      if (pathname === '/models' && method === 'GET') return json(modelsPayload);
      if (pathname === '/status') return json(statusPayload);
      if (pathname === '/settings/gpu' && method === 'GET') return json(gpuPayload);
      if (pathname === '/queue') return json(queuePayload);
      if (pathname === '/index/folders') return json(foldersPayload);
      if (pathname === '/search' && method === 'POST') return json(searchPayload);
      return json({});
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.matchMedia;
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  it('does not re-render the results grid when only the indexing status changes', async () => {
    let commits = 0;
    render(
      <Profiler id="app" onRender={() => { commits += 1; }}>
        <App />
      </Profiler>
    );
    await screen.findByText('Ready to Search');

    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));
    // Let the first full poll round land so everything has settled.
    await new Promise(resolve => setTimeout(resolve, 2000));

    const rendersBefore = gridRenders.count;
    const commitsBefore = commits;
    expect(rendersBefore).toBeGreaterThan(0);

    // A real change: App re-renders with a new status object.
    statusPayload = { ...defaultStatus, is_indexing: true, percent: 10, progress: '1/10' };
    await waitFor(() => expect(commits).toBeGreaterThan(commitsBefore), { timeout: 4000 });
    // Give the other polls a chance to land as well.
    await new Promise(resolve => setTimeout(resolve, 1600));

    expect(commits).toBeGreaterThan(commitsBefore);
    expect(gridRenders.count).toBe(rendersBefore);
    expect(screen.getAllByAltText('Result')).toHaveLength(2);
  }, 20000);
});
