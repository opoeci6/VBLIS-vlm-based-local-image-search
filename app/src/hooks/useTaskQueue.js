import { useState, useEffect, useCallback, useRef } from 'react';
import { keepIfEqual } from '../utils/jsonEqual';
import { apiFetch } from '../utils/api';

export const useTaskQueue = (API_BASE, setToast) => {
  const [activeTask, setActiveTask] = useState(null);
  const [pendingTasks, setPendingTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [workerState, setWorkerState] = useState('running');
  const [pendingCount, setPendingCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [modelMismatch, setModelMismatch] = useState(null);
  const [activeModel, setActiveModel] = useState(null);

  const prevActiveTaskId = useRef(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/queue`);
      if (!res.ok) return;
      const data = await res.json();
      setActiveTask(keepIfEqual(data.active_task));
      setPendingTasks(keepIfEqual(data.pending_tasks || []));
      setHistory(keepIfEqual(data.history || []));
      setWorkerState(data.worker_state || 'running');
      setPendingCount(data.pending_count || 0);
      setHistoryCount(data.history_count || 0);
      const rawMismatch = data.model_mismatch || null;
      const normalizedMismatch = rawMismatch
        ? {
            ...rawMismatch,
            isMismatch: Boolean(rawMismatch.is_mismatch ?? rawMismatch.isMismatch),
            is_mismatch: Boolean(rawMismatch.is_mismatch ?? rawMismatch.isMismatch),
            queued_model: rawMismatch.queued_model ?? rawMismatch.queuedModel ?? '',
            queuedModel: rawMismatch.queued_model ?? rawMismatch.queuedModel ?? '',
            active_model: rawMismatch.active_model ?? rawMismatch.activeModel ?? null,
            activeModel: rawMismatch.active_model ?? rawMismatch.activeModel ?? null,
            reason: rawMismatch.reason || ''
          }
        : null;
      setModelMismatch(keepIfEqual(normalizedMismatch));
      setActiveModel(data.active_model || null);

      // Toast when an active task completes
      if (prevActiveTaskId.current && !data.active_task && data.history && data.history.length > 0) {
        const lastFinished = data.history[0];
        if (lastFinished.id === prevActiveTaskId.current) {
          if (lastFinished.status === 'completed') {
            setToast?.({
              message: `Task completed: ${lastFinished.title} (${lastFinished.processed_count} items)`,
              type: 'success'
            });
          } else if (lastFinished.status === 'failed') {
            setToast?.({
              message: `Task failed: ${lastFinished.title}`,
              type: 'error'
            });
          }
        }
      }
      prevActiveTaskId.current = data.active_task ? data.active_task.id : null;
    } catch {
      // Backend polling error ignored silently
    }
  }, [API_BASE, setToast]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 1200);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const enqueueFolderIndexing = useCallback(async (folderPaths, priority = 'bottom') => {
    if (!folderPaths || folderPaths.length === 0) return null;
    try {
      const res = await apiFetch(`${API_BASE}/queue/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'INDEX_FOLDERS',
          payload: { folder_paths: folderPaths },
          priority
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.duplicates && data.duplicates.length > 0 && (!data.tasks || data.tasks.length === 0)) {
          setToast?.({
            message: `Folder is already in the queue: ${data.duplicates[0].path}`,
            type: 'info'
          });
        } else {
          setToast?.({
            message: data.message || `Added ${folderPaths.length} folder(s) to queue.`,
            type: 'success'
          });
        }
        fetchQueue();
        return data;
      } else {
        setToast?.({ message: `Queue error: ${data.detail || res.statusText}`, type: 'error' });
        return null;
      }
    } catch {
      setToast?.({ message: 'Failed to connect to task queue.', type: 'error' });
      return null;
    }
  }, [API_BASE, setToast, fetchQueue]);

  const cancelTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: 'Task cancellation requested.', type: 'info' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || 'Failed to cancel task.', type: 'error' });
      }
    } catch {
      setToast?.({ message: 'Network error cancelling task.', type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const pauseTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: 'Task paused.', type: 'info' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || 'Failed to pause task.', type: 'error' });
      }
    } catch {
      setToast?.({ message: 'Network error pausing task.', type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const resumeTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: 'Task resumed.', type: 'success' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || 'Failed to resume task.', type: 'error' });
      }
    } catch {
      setToast?.({ message: 'Network error resuming task.', type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const controlWorker = useCallback(async (action, adoptModel = false) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adopt_model: adoptModel })
      });
      const data = await res.json();
      if (res.ok) {
        if (action === 'start' || action === 'adopt_active_model') {
          setToast?.({ message: 'Queue worker started.', type: 'success' });
        } else if (action === 'pause_immediate') {
          setToast?.({ message: 'Queue worker stopped immediately.', type: 'info' });
        } else if (action === 'pause_after_current') {
          setToast?.({ message: 'Queue will stop after active task completes.', type: 'info' });
        }
        setShowStopModal(false);
        fetchQueue();
      } else {
        setToast?.({
          message: data.detail || 'Failed to update queue worker state.',
          type: 'error'
        });
        fetchQueue();
      }
    } catch {
      setToast?.({ message: 'Failed to send worker control signal.', type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const moveTask = useCallback(async (taskId, direction) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
      });
      if (res.ok) {
        fetchQueue();
      }
    } catch (err) {
      console.error(err);
    }
  }, [API_BASE, fetchQueue]);

  const reorderTasks = useCallback(async (newOrderedTasks) => {
    // Optimistically update pendingTasks state immediately
    setPendingTasks(newOrderedTasks);
    try {
      const taskIds = newOrderedTasks.map((t) => t.id);
      const res = await apiFetch(`${API_BASE}/queue/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: taskIds })
      });
      if (!res.ok) {
        fetchQueue();
      }
    } catch (err) {
      console.error(err);
      fetchQueue();
    }
  }, [API_BASE, fetchQueue]);

  const retryTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: `Re-queued task: ${data.task?.title || ''}`, type: 'success' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || 'Failed to retry task.', type: 'error' });
      }
    } catch {
      setToast?.({ message: 'Network error retrying task.', type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const clearHistory = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/history`, { method: 'DELETE' });
      if (res.ok) {
        setToast?.({ message: 'Cleared task history.', type: 'info' });
        fetchQueue();
      }
    } catch (err) {
      console.error(err);
    }
  }, [API_BASE, setToast, fetchQueue]);

  return {
    activeTask,
    pendingTasks,
    history,
    workerState,
    pendingCount,
    historyCount,
    isDrawerOpen,
    setIsDrawerOpen,
    showStopModal,
    setShowStopModal,
    modelMismatch,
    activeModel,
    fetchQueue,
    enqueueFolderIndexing,
    cancelTask,
    pauseTask,
    resumeTask,
    controlWorker,
    moveTask,
    reorderTasks,
    retryTask,
    clearHistory
  };
};
