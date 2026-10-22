import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config';

export const useBackendStatus = ({ setToast }) => {
  const [status, setStatus] = useState({
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
    total_video_frames_to_rebuild: 0
  });
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const [isCancellingIndexing, setIsCancellingIndexing] = useState(false);
  const prevIsIndexing = useRef(false);
  const prevLastTaskId = useRef(0);

  // Poll status and backend boot
  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        if (mounted) setStatus(data);
      } catch { /* backend not reachable yet; ignore */ }
    };

    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus();
    }, 1500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Alert for indexing completion with errors
  useEffect(() => {
    // Show alert if a task just finished and there were errors
    if (status.last_task_id > prevLastTaskId.current) {
      if (status.errors > 0) {
        setShowErrorAlert(true);
      } else if (status.discovered_video_count > 0) {
        setToast({
          message: `Indexed ${status.indexed_video_frames || 0} adaptive frame(s) from ${status.discovered_video_count} video file(s).`,
          type: 'success'
        });
      } else if (status.total_files === 0 && !status.is_indexing) {
        // Only toast about 0 files if it's a "fresh" completion
        setToast({ message: "No supported images or videos were found in the selected folder.", type: 'error' });
      }
    }

    // Also support the traditional "transition from indexing to not indexing" for safety
    if (prevIsIndexing.current === true && status.is_indexing === false && status.errors > 0) {
      setShowErrorAlert(true);
    }

    // If a new indexing starts, hide previous alert
    if (status.is_indexing === true && prevIsIndexing.current === false) {
      setShowErrorAlert(false);
    }

    prevIsIndexing.current = status.is_indexing;
    prevLastTaskId.current = status.last_task_id;
  }, [status.is_indexing, status.errors, status.last_task_id, status.total_files, status.discovered_video_count, status.indexed_video_frames, setToast]);

  const handleCancelIndexing = async () => {
    if (isCancellingIndexing) return;
    setIsCancellingIndexing(true);
    try {
      await fetch(`${API_BASE}/index/cancel`, { method: 'POST' });
      setToast({ message: "Indexing cancellation requested.", type: 'info' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to cancel indexing.", type: 'error' });
    } finally {
      setIsCancellingIndexing(false);
    }
  };

  return {
    status,
    setStatus,
    showErrorAlert,
    setShowErrorAlert,
    isCancellingIndexing,
    handleCancelIndexing
  };
};
