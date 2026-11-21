import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { resetEscapeKeyForTests } from '../../hooks/useEscapeKey';
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

  it('closes the drawer and opens the settings on the models group from "Open Settings"', () => {
    const calls = [];
    const onClose = vi.fn(() => calls.push('close'));
    const onOpenSettings = vi.fn((group) => calls.push(`open:${group}`));
    render(<QueueDrawer isOpen onClose={onClose} queue={makeQueue({ pendingTasks: [indexTask], pendingCount: 1 })} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('models');
    expect(calls).toEqual(['close', 'open:models']);
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

// jsdom runs history traversals asynchronously and fires popstate, like a browser: wait for them to land.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const back = async () => {
  await act(async () => { window.history.back(); });
  await settle();
};

describe('QueueDrawer on a phone', () => {
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

  it('names its close button, and closes with Esc and the button', () => {
    const onClose = vi.fn();
    renderDrawer(makeQueue(), onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes the stop confirmation with Esc before the drawer under it', () => {
    const onClose = vi.fn();
    const setShowStopModal = vi.fn();
    // The confirmation opens while the drawer is showing, so it registers its Esc later.
    const { rerender } = render(<QueueDrawer isOpen onClose={onClose} queue={makeQueue({ setShowStopModal })} />);
    rerender(<QueueDrawer isOpen onClose={onClose} queue={makeQueue({ showStopModal: true, setShowStopModal })} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setShowStopModal).toHaveBeenCalledWith(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not listen for Esc while closed', () => {
    const onClose = vi.fn();
    render(<QueueDrawer isOpen={false} onClose={onClose} queue={makeQueue()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('makes no history calls outside network mode', async () => {
    renderDrawer(makeQueue());
    await settle();
    expect(pushState).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('pushes one history entry when it opens and closes with Back in network mode', async () => {
    setNetworkModeForTests(true);
    const onClose = vi.fn();
    const queue = makeQueue();
    const { rerender } = render(<QueueDrawer isOpen={false} onClose={onClose} queue={queue} />);
    await settle();
    expect(pushState).not.toHaveBeenCalled();

    await act(async () => { rerender(<QueueDrawer isOpen onClose={onClose} queue={queue} />); });
    expect(pushState).toHaveBeenCalledTimes(1);
    await back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the icon buttons of the queued tasks a name', () => {
    const tasks = [
      { id: 1, type: 'SCAN_MEDIA_INFO', title: 'One', progress: 0 },
      { id: 2, type: 'SCAN_MEDIA_INFO', title: 'Two', progress: 0 },
      { id: 3, type: 'SCAN_MEDIA_INFO', title: 'Three', progress: 0 },
    ];
    renderDrawer(makeQueue({ pendingTasks: tasks, pendingCount: 3 }));
    expect(screen.getAllByRole('button', { name: 'Move to top of queue' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Move up' }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: 'Move down' }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: 'Remove from queue' }).length).toBe(3);
  });
});
