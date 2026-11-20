import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

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

const images = [
  { path: '/photos/cat.jpg', media_type: 'image', score: 0.91, hash: 'h1' },
  { path: '/photos/dog.jpg', media_type: 'image', score: 0.8, hash: 'h2' },
];

// One video with three matching frames (best first: 0:20, 0:10, 0:30), next to the two images.
const frames = [
  { path: '/videos/clip.mp4', media_type: 'video', score: 0.9, timestamp_seconds: 10 },
  { path: '/videos/clip.mp4', media_type: 'video', score: 0.95, timestamp_seconds: 20 },
  { path: '/videos/clip.mp4', media_type: 'video', score: 0.85, timestamp_seconds: 30 },
];

// Fresh deep copy per call, like a real network response.
const json = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });

describe('App lightbox navigation', () => {
  let searchPayload;

  const search = async () => {
    render(<App />);
    await screen.findByText('Ready to Search');
    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  };

  beforeEach(() => {
    searchPayload = { results: images };
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
      if (pathname === '/status') return json(defaultStatus);
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

  it('steps through the image results of a search', async () => {
    await search();
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

    fireEvent.click(screen.getAllByAltText('Result')[0]);
    expect(await screen.findByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('/photos/cat.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous picture' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(await screen.findByText('2 / 2')).toBeTruthy();
    expect(screen.getByText('/photos/dog.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next picture' }).disabled).toBe(true);

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(await screen.findByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('/photos/cat.jpg')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('1 / 2')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
  });

  it('keeps to the frames of the open video group, in the order the group shows them', async () => {
    searchPayload = { results: [...images, ...frames] };
    await search();
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(2));

    fireEvent.click(screen.getByAltText('Best matching frame from clip.mp4'));
    // The group modal lists the frames best first: 0:20, 0:10, 0:30.
    fireEvent.click(await screen.findByAltText('Video frame at 0:10'));
    expect(await screen.findByText('2 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(await screen.findByText('3 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next picture' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    expect(await screen.findByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous picture' }).disabled).toBe(true);
    // Never one of the two images.
    expect(screen.queryByText('/photos/cat.jpg')).toBeNull();
  });

  it('shows no navigation for a lone image result', async () => {
    searchPayload = { results: [images[0]] };
    await search();
    await waitFor(() => expect(screen.getAllByAltText('Result')).toHaveLength(1));
    fireEvent.click(screen.getByAltText('Result'));
    expect(await screen.findByText('/photos/cat.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
  });
});
