import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueueDrawer } from './QueueDrawer';

const scanTask = { id: 1, type: 'SCAN_MEDIA_INFO', title: 'Read media details', status: 'pending', progress: 0, model_id: null };
const indexTask = { id: 2, type: 'INDEX_FOLDERS', title: 'Index folders', status: 'pending', progress: 0, model_id: 'org/model-a' };

const makeQueue = (extra = {}) => ({
  activeTask: null,
  pendingTasks: [],
  history: [],
  workerState: 'paused',
  pendingCount: 0,
  historyCount: 0,
  showStopModal: false,
  setShowStopModal: vi.fn(),
  modelMismatch: null,
  activeModel: null,
  cancelTask: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  controlWorker: vi.fn(),
  moveTask: vi.fn(),
  reorderTasks: vi.fn(),
  retryTask: vi.fn(),
  clearHistory: vi.fn(),
  ...extra,
});

const renderDrawer = (queue, onClose = vi.fn()) => render(<QueueDrawer isOpen onClose={onClose} queue={queue} onOpenSettings={vi.fn()} />);

describe('QueueDrawer no-model banner', () => {
  afterEach(cleanup);

  it('is hidden for a scan-only queue with no model loaded', () => {
    renderDrawer(makeQueue({ pendingTasks: [scanTask], pendingCount: 1 }));
    expect(screen.queryByText('No AI Model Loaded in Memory')).toBeNull();
    expect(screen.getByText('Read media details')).toBeTruthy();
  });

  it('is hidden for a running scan with no model loaded', () => {
    renderDrawer(makeQueue({ activeTask: { ...scanTask, status: 'running' }, workerState: 'running' }));
    expect(screen.queryByText('No AI Model Loaded in Memory')).toBeNull();
  });

  it('shows for a pending index task with no model loaded', () => {
    renderDrawer(makeQueue({ pendingTasks: [indexTask], pendingCount: 1 }));
    expect(screen.getByText('No AI Model Loaded in Memory')).toBeTruthy();
    expect(screen.getByText(/Tasks were queued for 'model-a'/)).toBeTruthy();
  });

  it('shows when an index task is queued behind a scan, naming the index task model', () => {
    renderDrawer(makeQueue({ pendingTasks: [scanTask, indexTask], pendingCount: 2 }));
    expect(screen.getByText('No AI Model Loaded in Memory')).toBeTruthy();
    expect(screen.getByText(/Tasks were queued for 'model-a'/)).toBeTruthy();
  });

  it('still shows when the backend reports no_model_loaded', () => {
    renderDrawer(makeQueue({
      pendingTasks: [indexTask],
      pendingCount: 1,
      modelMismatch: { isMismatch: true, reason: 'no_model_loaded', queued_model: 'org/model-a' },
    }));
    expect(screen.getByText('No AI Model Loaded in Memory')).toBeTruthy();
  });

  it('is hidden when a model is loaded', () => {
    renderDrawer(makeQueue({ pendingTasks: [indexTask], pendingCount: 1, activeModel: 'org/model-a' }));
    expect(screen.queryByText('No AI Model Loaded in Memory')).toBeNull();
  });
});

describe('QueueDrawer backdrop', () => {
  afterEach(cleanup);

  it('closes on a backdrop click but not on a click inside the drawer', () => {
    const onClose = vi.fn();
    const { container } = renderDrawer(makeQueue(), onClose);
    fireEvent.click(screen.getByText('Task Queue Manager'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when a drag from inside the drawer ends on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = renderDrawer(makeQueue(), onClose);
    fireEvent.mouseDown(screen.getByText('Task Queue Manager'));
    fireEvent.click(container.firstChild);
    expect(onClose).not.toHaveBeenCalled();
  });
});
