import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

export const useFolderContents = ({ activeModel, lastTaskId, setToast, refreshFolders }) => {
  const [showFolderContents, setShowFolderContents] = useState(false);
  const [browsingFolder, setBrowsingFolder] = useState(null);
  const [folderContents, setFolderContents] = useState(null);
  const [isFetchingFolderContents, setIsFetchingFolderContents] = useState(false);
  const [isCleaningGhostRecords, setIsCleaningGhostRecords] = useState(false);
  const [folderVisibleLimit, setFolderVisibleLimit] = useState(60);

  const handleBrowseFolderContents = useCallback(async (folder, silent = false) => {
    if (!folder) return;
    if (!silent) {
      setBrowsingFolder(folder);
      setFolderContents(null);
      setFolderVisibleLimit(60);
      setShowFolderContents(true);
      setIsFetchingFolderContents(true);
    }

    try {
      const url = new URL(`${API_BASE}/index/folder/contents`);
      url.searchParams.set('folder_path', folder.path);
      const res = await fetch(url.toString());
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to browse folder contents.');
      }

      setFolderContents(data);
    } catch (err) {
      console.error(err);
      if (!silent) {
        setToast({ message: err.message || 'Failed to browse folder contents.', type: 'error' });
        setShowFolderContents(false);
        setBrowsingFolder(null);
      }
      // Immediately refresh indexed folders to update missing status in the tree UI
      refreshFolders(true);
    } finally {
      if (!silent) {
        setIsFetchingFolderContents(false);
      }
    }
  }, [setToast, refreshFolders]);

  const handleCloseFolderContents = () => {
    setShowFolderContents(false);
    setBrowsingFolder(null);
    setFolderContents(null);
    setFolderVisibleLimit(60);
  };

  // 1. Task completions: refresh the open Folder Contents modal live
  useEffect(() => {
    if (activeModel) {
      // If Folder Contents modal is currently open, refresh its contents live!
      if (showFolderContents && browsingFolder) {
        handleBrowseFolderContents(browsingFolder, true);
      }
    }
    // Deps intentionally exclude showFolderContents/browsingFolder: including them would trigger
    // an extra silent fetch every time the modal opens (the explicit browse already fetches).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModel, lastTaskId]);

  // 3. Live Sync on Window Focus (updates open Folder Contents modal)
  useEffect(() => {
    const handleWindowFocus = () => {
      if (activeModel) {
        if (showFolderContents && browsingFolder) {
          handleBrowseFolderContents(browsingFolder, true);
        }
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [activeModel, showFolderContents, browsingFolder, handleBrowseFolderContents]);

  // 5. Polling while Folder Contents modal is open (every 10 seconds)
  useEffect(() => {
    if (!showFolderContents || !browsingFolder || !activeModel) return;
    const interval = setInterval(() => {
      handleBrowseFolderContents(browsingFolder, true);
    }, 10000);
    return () => clearInterval(interval);
  }, [showFolderContents, browsingFolder, activeModel, handleBrowseFolderContents]);

  return {
    showFolderContents,
    browsingFolder,
    folderContents,
    isFetchingFolderContents,
    isCleaningGhostRecords,
    setIsCleaningGhostRecords,
    folderVisibleLimit,
    setFolderVisibleLimit,
    handleBrowseFolderContents,
    handleCloseFolderContents
  };
};
