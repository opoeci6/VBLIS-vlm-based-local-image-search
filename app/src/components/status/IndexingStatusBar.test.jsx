import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IndexingStatusBar } from './IndexingStatusBar';

const makeQueue = (extra = {}) => ({
  activeTask: null,
  pendingTasks: [],
  pendingCount: 0,
  workerState: 'running',
  modelMismatch: null,
  activeModel: 'org/model-a',
  resumeTask: vi.fn(),
  pauseTask: vi.fn(),
  cancelTask: vi.fn(),
  controlWorker: vi.fn(),
  setIsDrawerOpen: vi.fn(),
  ...extra,
});

const runningTask = {
  id: 7,
  title: 'Indexing holiday photos',
  status: 'running',
  progress: 42,
  processed_count: 21,
  total_count: 50,
  current_item: '/photos/a.jpg',
};

const makeProps = (overrides = {}) => ({
  status: { is_indexing: true, percent: 10, progress: '1/10', current_file: '/f.jpg' },
  queue: makeQueue({ activeTask: runningTask }),
  setToast: vi.fn(),
  setShowSettings: vi.fn(),
  isCancellingIndexing: false,
  handleCancelIndexing: vi.fn(),
  ...overrides,
});

const renderBar = (overrides) => {
  const props = makeProps(overrides);
  return { props, ...render(<IndexingStatusBar {...props} />) };
};

describe('IndexingStatusBar', () => {
  afterEach(cleanup);

  it('renders nothing when idle', () => {
    const { container } = renderBar({
      status: { is_indexing: false, percent: 0, progress: '0/0' },
      queue: makeQueue(),
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for pending tasks while the worker is running', () => {
    const { container } = renderBar({
      status: { is_indexing: false, percent: 0, progress: '0/0' },
      queue: makeQueue({ pendingCount: 2, pendingTasks: [{ id: 1 }, { id: 2 }] }),
    });
    expect(container.firstChild).toBeNull();
  });

  it('shows the title, percentage and processed/total from the active task', () => {
    renderBar();
    expect(screen.getByText(/Indexing holiday photos/)).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('(21/50)')).toBeTruthy();
    expect(screen.getByText('Processing: /photos/a.jpg')).toBeTruthy();
  });

  it('falls back to the global status when there is no task', () => {
    renderBar({
      status: { is_indexing: true, percent: 33.4, progress: '3/9', current_file: '/x.jpg' },
      queue: makeQueue(),
    });
    expect(screen.getByText(/Indexing Media/)).toBeTruthy();
    expect(screen.getByText('33%')).toBeTruthy();
    expect(screen.getByText('(0/3/9)')).toBeTruthy();
  });

  describe('Resume with no model loaded (regression: used to throw a ReferenceError)', () => {
    it('toasts an error and opens settings without touching the queue', () => {
      const queue = makeQueue({
        activeTask: { ...runningTask, status: 'paused', is_paused: true },
        activeModel: null,
        modelMismatch: { reason: 'no_model_loaded' },
        workerState: 'paused',
      });
      const { props } = renderBar({ queue });

      expect(screen.getByText('NO MODEL LOADED')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Resume/ }));

      expect(props.setToast).toHaveBeenCalledWith({
        message: 'Cannot resume queue: No AI model is currently loaded in memory. Please select a model in Settings.',
        type: 'error',
      });
      expect(props.setShowSettings).toHaveBeenCalledWith(true);
      expect(queue.resumeTask).not.toHaveBeenCalled();
      expect(queue.controlWorker).not.toHaveBeenCalled();
    });
  });

  describe('Resume', () => {
    it('adopts the active model on a model mismatch', () => {
      const queue = makeQueue({
        pendingCount: 1,
        pendingTasks: [{ id: 2, title: 'Queued', progress: 0, processed_count: 0, total_count: 5 }],
        workerState: 'paused',
        modelMismatch: { reason: 'model_difference', active_model: 'org/model-a', queued_model: 'org/model-b' },
      });
      renderBar({ status: { is_indexing: false, percent: 0, progress: '0/0' }, queue });

      expect(screen.getByText('MODEL MISMATCH')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Adopt & Resume/ }));
      expect(queue.controlWorker).toHaveBeenCalledWith('start', true);
    });

    it('resumes the active task and starts a paused worker normally', () => {
      const queue = makeQueue({
        activeTask: { ...runningTask, status: 'paused', is_paused: true },
        workerState: 'paused',
      });
      renderBar({ queue });

      expect(screen.getByText('PAUSED')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
      expect(queue.resumeTask).toHaveBeenCalledWith(7);
      expect(queue.controlWorker).toHaveBeenCalledWith('start');
    });
  });

  describe('Pause', () => {
    it('pauses the active task', () => {
      const queue = makeQueue({ activeTask: runningTask });
      renderBar({ queue });
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      expect(queue.pauseTask).toHaveBeenCalledWith(7);
      expect(queue.controlWorker).not.toHaveBeenCalled();
    });

    it('pauses the worker immediately when there is no active task', () => {
      const queue = makeQueue();
      renderBar({ queue });
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      expect(queue.controlWorker).toHaveBeenCalledWith('pause_immediate');
    });
  });

  describe('Cancel', () => {
    it('cancels the active task', () => {
      const queue = makeQueue({ activeTask: runningTask, pendingTasks: [{ id: 99 }] });
      const { props } = renderBar({ queue });
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
      expect(queue.cancelTask).toHaveBeenCalledWith(7);
      expect(props.handleCancelIndexing).not.toHaveBeenCalled();
    });

    it('cancels the first pending task when nothing is active', () => {
      const queue = makeQueue({
        pendingCount: 1,
        pendingTasks: [{ id: 5, title: 'Queued', progress: 0, processed_count: 0, total_count: 3 }],
        workerState: 'paused',
      });
      const { props } = renderBar({ status: { is_indexing: false, percent: 0, progress: '0/0' }, queue });
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
      expect(queue.cancelTask).toHaveBeenCalledWith(5);
      expect(props.handleCancelIndexing).not.toHaveBeenCalled();
    });

    it('falls back to handleCancelIndexing without any tasks', () => {
      const { props } = renderBar({ queue: makeQueue() });
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
      expect(props.handleCancelIndexing).toHaveBeenCalledTimes(1);
    });

    it('is disabled and relabelled while cancelling', () => {
      renderBar({ isCancellingIndexing: true });
      const button = screen.getByRole('button', { name: /Cancelling/ });
      expect(button.disabled).toBe(true);
    });

    it('is disabled when the backend reports cancel_requested', () => {
      renderBar({ status: { is_indexing: true, percent: 1, progress: '1/2', cancel_requested: true } });
      expect(screen.getByRole('button', { name: /Cancelling/ }).disabled).toBe(true);
    });
  });

  it('opens the task queue drawer', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByText('View in Task Queue →'));
    expect(props.queue.setIsDrawerOpen).toHaveBeenCalledWith(true);
  });
});
