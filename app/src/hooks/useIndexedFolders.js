import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '../config';
import { keepIfEqual } from '../utils/jsonEqual';
import { getAllSelectablePaths, toggleFolderSelection as toggleFolderSelectionPure } from '../utils/folderSelection';
import { apiFetch } from '../utils/api';
import i18n from '../i18n';

export const useIndexedFolders = ({ activeModel, lastTaskId, isExpanded, setToast, onIndexChanged }) => {
  const [indexedFolders, setIndexedFolders] = useState([]);
  const [isFetchingFolders, setIsFetchingFolders] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const fetchIndexedFolders = useCallback(async (silent = false) => {
    if (!activeModel) return;
    if (!silent) setIsFetchingFolders(true);
    try {
      const res = await apiFetch(`${API_BASE}/index/folders`);
      const data = await res.json();
      setIndexedFolders(keepIfEqual(data.folders || []));
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsFetchingFolders(false);
    }
  }, [activeModel]);

  const handleReindexFolder = useCallback(async (folder_path) => {
    try {
      const res = await apiFetch(`${API_BASE}/index/folder/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path })
      });
      if (res.ok) {
        setToast({ message: i18n.t('messages:indexedFolders.reindexStarted'), type: 'success' });
      } else {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        // The backend's detail is English text; a detail that is not a string (a validation error) never matches.
        const detail = typeof error?.detail === 'string' ? error.detail.toLowerCase() : '';
        const isMissing = detail.includes('invalid directory') || detail.includes('not exist');
        setToast({
          message: isMissing
            ? i18n.t('messages:indexedFolders.folderNotAccessible')
            : i18n.t('messages:indexedFolders.error', { detail: typeof error?.detail === 'string' ? error.detail : res.statusText }),
          type: 'error'
        });
        fetchIndexedFolders(true);
      }
    } catch (err) {
      console.error(err);
      setToast({ message: i18n.t('messages:indexedFolders.reindexConnectFailed'), type: 'error' });
      fetchIndexedFolders(true);
    }
  }, [setToast, fetchIndexedFolders]);

  const handleDeleteFolderIndex = async (folder_path) => {
    try {
      const res = await apiFetch(`${API_BASE}/index/folder/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path })
      });
      if (res.ok) {
        setToast({ message: i18n.t('messages:indexedFolders.indexRemoved'), type: 'success' });
        setSelectedFolders(prev => prev.filter(path => path !== folder_path));
        fetchIndexedFolders();
        // Reset results as they might be stale
        onIndexChanged?.();
      } else {
        const error = await res.json();
        setToast({ message: i18n.t('messages:indexedFolders.error', { detail: error.detail }), type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: i18n.t('messages:indexedFolders.removeFailed'), type: 'error' });
    }
  };

  const handleBatchDelete = async () => {
    if (selectedFolders.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await apiFetch(`${API_BASE}/index/folders/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_paths: selectedFolders })
      });
      if (res.ok) {
        setToast({ message: i18n.t('messages:indexedFolders.batchRemoved', { count: selectedFolders.length }), type: 'success' });
        setSelectedFolders([]);
        fetchIndexedFolders();
        // Reset results as they might be stale
        onIndexChanged?.();
      }
    } catch (err) {
      console.error(err);
      setToast({ message: i18n.t('messages:indexedFolders.batchDeleteFailed'), type: 'error' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchReindex = async () => {
    if (selectedFolders.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await apiFetch(`${API_BASE}/index/folders/batch-reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_paths: selectedFolders })
      });
      if (res.ok) {
        setToast({ message: i18n.t('messages:indexedFolders.batchReindexStarted', { count: selectedFolders.length }), type: 'success' });
        setSelectedFolders([]);
      }
    } catch (err) {
      console.error(err);
      setToast({ message: i18n.t('messages:indexedFolders.batchReindexFailed'), type: 'error' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const allSelectableFolderPaths = useMemo(() => {
    return getAllSelectablePaths(indexedFolders);
  }, [indexedFolders]);

  const toggleFolderSelection = (targetPath, isSubfolder = false, parentFolder = null) => setSelectedFolders(prev => toggleFolderSelectionPure(prev, targetPath, isSubfolder, parentFolder));

  const toggleSelectAll = () => {
    if (selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0) {
      setSelectedFolders([]);
    } else {
      setSelectedFolders(allSelectableFolderPaths);
    }
  };

  // 1. Initial load & task completions (auto-updates tree)
  useEffect(() => {
    if (activeModel) {
      fetchIndexedFolders();
    }
  }, [activeModel, lastTaskId, fetchIndexedFolders]);

  // 2. Refresh folder existence whenever user opens/expands the Indexed Folders panel
  useEffect(() => {
    if (isExpanded && activeModel) {
      fetchIndexedFolders(true);
    }
  }, [isExpanded, activeModel, fetchIndexedFolders]);

  // 3. Live Sync on Window Focus (updates folder tree)
  useEffect(() => {
    const handleWindowFocus = () => {
      if (activeModel) {
        fetchIndexedFolders(true);
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [activeModel, fetchIndexedFolders]);

  // 4. Polling while folder list is expanded (every 8 seconds)
  useEffect(() => {
    if (!isExpanded || !activeModel) return;
    const interval = setInterval(() => {
      fetchIndexedFolders(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [isExpanded, activeModel, fetchIndexedFolders]);

  useEffect(() => {
    setSelectedFolders([]);
  }, [activeModel]);

  return {
    indexedFolders,
    isFetchingFolders,
    selectedFolders,
    isBatchProcessing,
    fetchIndexedFolders,
    handleReindexFolder,
    handleDeleteFolderIndex,
    handleBatchDelete,
    handleBatchReindex,
    allSelectableFolderPaths,
    toggleFolderSelection,
    toggleSelectAll
  };
};
