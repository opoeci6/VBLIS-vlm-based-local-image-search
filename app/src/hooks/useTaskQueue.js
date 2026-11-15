import { useState, useEffect, useCallback, useRef } from 'react';
import { keepIfEqual } from '../utils/jsonEqual';
import { apiFetch } from '../utils/api';
import { taskTitle } from '../utils/taskTitle';
import i18n from '../i18n';

// The toast for folders that were just queued. The backend's own message is English, so it is
// built here from the counts in the response.
const enqueueMessage = (data, folderCount) => {
  if (!Array.isArray(data.tasks)) return i18n.t('messages:taskQueue.added', { count: folderCount });
  const added = data.tasks.length;
  const skipped = Array.isArray(data.duplicates) ? data.duplicates.length : 0;
  if (skipped > 0) return i18n.t('messages:taskQueue.enqueuedWithSkipped', { tasks: added, duplicates: skipped });
  return i18n.t('messages:taskQueue.enqueued', { count: added });
};

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
              message: i18n.t('messages:taskQueue.completed', { title: taskTitle(lastFinished), count: lastFinished.processed_count ?? 0 }),
              type: 'success'
            });
          } else if (lastFinished.status === 'failed') {
            setToast?.({
              message: i18n.t('messages:taskQueue.failed', { title: taskTitle(lastFinished) }),
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
            message: i18n.t('messages:taskQueue.alreadyQueued', { path: data.duplicates[0].path }),
            type: 'info'
          });
        } else {
          setToast?.({
            message: enqueueMessage(data, folderPaths.length),
            type: 'success'
          });
        }
        fetchQueue();
        return data;
      } else {
        setToast?.({ message: i18n.t('messages:taskQueue.queueError', { detail: data.detail || res.statusText }), type: 'error' });
        return null;
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.connectFailed'), type: 'error' });
      return null;
    }
  }, [API_BASE, setToast, fetchQueue]);

  const cancelTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: i18n.t('messages:taskQueue.cancelRequested'), type: 'info' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || i18n.t('messages:taskQueue.cancelFailed'), type: 'error' });
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.cancelNetworkError'), type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const pauseTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: i18n.t('messages:taskQueue.paused'), type: 'info' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || i18n.t('messages:taskQueue.pauseFailed'), type: 'error' });
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.pauseNetworkError'), type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const resumeTask = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/${taskId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast?.({ message: i18n.t('messages:taskQueue.resumed'), type: 'success' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || i18n.t('messages:taskQueue.resumeFailed'), type: 'error' });
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.resumeNetworkError'), type: 'error' });
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
          setToast?.({ message: i18n.t('messages:taskQueue.workerStarted'), type: 'success' });
        } else if (action === 'pause_immediate') {
          setToast?.({ message: i18n.t('messages:taskQueue.workerStopped'), type: 'info' });
        } else if (action === 'pause_after_current') {
          setToast?.({ message: i18n.t('messages:taskQueue.workerStopsAfterCurrent'), type: 'info' });
        }
        setShowStopModal(false);
        fetchQueue();
      } else {
        setToast?.({
          message: data.detail || i18n.t('messages:taskQueue.workerUpdateFailed'),
          type: 'error'
        });
        fetchQueue();
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.workerSignalFailed'), type: 'error' });
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
        setToast?.({ message: i18n.t('messages:taskQueue.requeued', { title: taskTitle(data.task) || '' }), type: 'success' });
        fetchQueue();
      } else {
        setToast?.({ message: data.detail || i18n.t('messages:taskQueue.retryFailed'), type: 'error' });
      }
    } catch {
      setToast?.({ message: i18n.t('messages:taskQueue.retryNetworkError'), type: 'error' });
    }
  }, [API_BASE, setToast, fetchQueue]);

  const clearHistory = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/queue/history`, { method: 'DELETE' });
      if (res.ok) {
        setToast?.({ message: i18n.t('messages:taskQueue.historyCleared'), type: 'info' });
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
