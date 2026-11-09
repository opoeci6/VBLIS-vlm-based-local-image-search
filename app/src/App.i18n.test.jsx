import { Profiler, memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { formatDuration } from './utils/formatters';
import App from './App';

// The terminal-theme logo needs canvas, which jsdom lacks.
vi.mock('./components/common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

// Components that stand in for the real ones: they follow the pattern the app uses (see src/i18n/index.js).
const Probe = ({ name = 'probe' }) => {
  const { t } = useTranslation('common');
  return <span data-testid={name}>{t('cancel')}</span>;
};

// Shows language-dependent output only through a formatter, and subscribes for that reason alone.
const FormatterProbe = () => {
  useTranslation('format');
  return <span data-testid="duration">{formatDuration(125)}</span>;
};

describe('i18n foundation', () => {
  let commits;
  let warn;
  let error;
  const onRender = (id, phase) => { commits.push({ id, phase }); };

  beforeEach(() => {
    commits = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is initialized as soon as it is imported, in English, with <html lang> set', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('shows translated text synchronously after render, with one mount commit and no warnings', () => {
    render(
      <Profiler id="probe" onRender={onRender}>
        <Probe />
      </Profiler>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('Cancel');
    expect(commits).toEqual([{ id: 'probe', phase: 'mount' }]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('switches several subscribed components in one commit', async () => {
    render(
      <Profiler id="probes" onRender={onRender}>
        <Probe name="one" />
        <Probe name="two" />
        <FormatterProbe />
      </Profiler>,
    );
    expect(screen.getByTestId('one').textContent).toBe('Cancel');
    expect(screen.getByTestId('duration').textContent).toBe('2m 5s');
    expect(commits).toHaveLength(1);

    await act(() => i18n.changeLanguage('zh-CN'));

    expect(commits).toHaveLength(2);
    expect(commits[1].phase).toBe('update');
    expect(screen.getByTestId('one').textContent).toBe('取消');
    expect(screen.getByTestId('two').textContent).toBe('取消');
    expect(screen.getByTestId('duration').textContent).toBe('2 分 5 秒');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    await act(() => i18n.changeLanguage('en'));
    expect(commits).toHaveLength(3);
    expect(screen.getByTestId('one').textContent).toBe('Cancel');
    expect(document.documentElement.lang).toBe('en');
  });

  it('updates a memoized component on a language switch without re-rendering its parent', async () => {
    let parentRenders = 0;
    const Memoized = memo(function Memoized() {
      const { t } = useTranslation('common');
      return <span data-testid="memo">{t('close')}</span>;
    });
    const Parent = () => {
      parentRenders += 1;
      return <Memoized />;
    };
    render(<Parent />);
    expect(screen.getByTestId('memo').textContent).toBe('Close');
    expect(parentRenders).toBe(1);

    await act(() => i18n.changeLanguage('zh-CN'));

    expect(screen.getByTestId('memo').textContent).toBe('关闭');
    expect(parentRenders).toBe(1);
  });
});

describe('App with translations', () => {
  const defaultStatus = {
    is_indexing: false, percent: 0, progress: '0/0', total_files: 0, indexed_files: 0, current_file: '',
    errors: 0, failed_files: [], last_task_id: 0, is_downloading: false, download_total_bytes: 0,
    download_current_bytes: 0, download_speed: 0, download_eta: 0, download_error: null, cancel_download: false,
    is_loading_model: false, discovered_video_count: 0, indexed_video_frames: 0,
    is_rebuilding_video_thumbnails: false, rebuilt_video_frames: 0, total_video_frames_to_rebuild: 0,
  };
  const payloads = {
    '/models': { active_model: 'org/model-a', models: [{ id: 'org/model-a', downloaded: true }] },
    '/status': defaultStatus,
    '/settings/gpu': {
      use_gpu: false, cuda_available: false, device: 'cpu', batch_size: 0, effective_batch_size: 16,
      precision_mode: 'auto', active_precision: 'fp32', fp16_supported: false, gpu_name: '',
    },
    '/queue': {
      active_task: null, pending_tasks: [], history: [], worker_state: 'running', pending_count: 0,
      history_count: 0, model_mismatch: null, active_model: 'org/model-a',
    },
    '/index/folders': {
      folders: [{ path: '/photos', name: 'photos', exists: true, image_count: 3, video_count: 0, subfolder_count: 0, subfolders: [] }],
    },
    '/image/cache/stats': {
      images: { count: 0, bytes: 0, formatted: '0 B' },
      videos: { count: 0, bytes: 0, formatted: '0 B' },
      total: { count: 0, bytes: 0, formatted: '0 B' },
    },
  };
  // Fresh deep copy per call, like a real network response (a shared instance would hide re-render churn).
  const json = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url) => json(payloads[new URL(String(url)).pathname] ?? {})));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme-style');
  });

  it('makes no React commits while idle, also after a language switch', async () => {
    let commits = 0;
    render(
      <Profiler id="app" onRender={() => { commits += 1; }}>
        <App />
      </Profiler>,
    );
    await screen.findByText('Ready to Search');
    await act(() => i18n.changeLanguage('zh-CN'));
    // Let the first full poll round (1.5 s interval) land so every state has settled.
    await new Promise(resolve => setTimeout(resolve, 2000));

    commits = 0;
    const statusCalls = () => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/status').length;
    const before = statusCalls();
    await new Promise(resolve => setTimeout(resolve, 4500));

    expect(statusCalls() - before).toBeGreaterThanOrEqual(2);
    expect(commits).toBe(0);
  }, 20000);

  it('shows the translated settings sections after a switch to Chinese', async () => {
    render(<App />);
    await screen.findByText('Ready to Search');
    await act(() => i18n.changeLanguage('zh-CN'));

    fireEvent.click(screen.getAllByTitle(/Active Vision Engine: org\/model-a/)[0]);
    expect(await screen.findByText('界面主题风格')).toBeTruthy();
    expect(screen.getByText('语言')).toBeTruthy();

    // Switching back with the Language section updates the sections that are already open.
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByText('UI Theme Style')).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
  });
});
