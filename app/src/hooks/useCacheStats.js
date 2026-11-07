import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';
import { apiFetch } from '../utils/api';

export const useCacheStats = ({ isSettingsOpen, status, setToast }) => {
  const [isClearingThumbnails, setIsClearingThumbnails] = useState(false);
  const [showConfirmClearThumbnails, setShowConfirmClearThumbnails] = useState(null); // null | 'all' | 'images' | 'videos'
  const [cacheStats, setCacheStats] = useState({
    images: { count: 0, bytes: 0, formatted: '0 B' },
    videos: { count: 0, bytes: 0, formatted: '0 B' },
    total: { count: 0, bytes: 0, formatted: '0 B' }
  });
  const [isTriggeringRebuildThumbnails, setIsTriggeringRebuildThumbnails] = useState(false);

  const fetchCacheStats = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/image/cache/stats`);
      if (res.ok) {
        const data = await res.json();
        setCacheStats(data);
      }
    } catch (e) {
      console.error("Failed to fetch cache stats:", e);
    }
  }, []);

  const handleClearThumbnailCache = async (target = 'all') => {
    setIsClearingThumbnails(true);
    try {
      const res = await apiFetch(`${API_BASE}/image/cache/clear?target=${target}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        const label = target === 'all' ? 'All' : target === 'images' ? 'Image' : 'Video';
        setToast({ message: `${label} thumbnail cache cleared successfully.`, type: 'success' });
        fetchCacheStats();
      } else {
        setToast({ message: data.detail || 'Failed to clear thumbnail cache.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to clear thumbnail cache.', type: 'error' });
    } finally {
      setIsClearingThumbnails(false);
      setShowConfirmClearThumbnails(null);
    }
  };

  const handleRebuildVideoThumbnails = async () => {
    if (status.is_rebuilding_video_thumbnails || status.is_indexing || isTriggeringRebuildThumbnails) return;
    setIsTriggeringRebuildThumbnails(true);
    try {
      const res = await apiFetch(`${API_BASE}/video/thumbnails/regenerate`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast({ message: 'Video thumbnail rebuilding started in background.', type: 'info' });
        fetchCacheStats();
      } else {
        setToast({ message: data.detail || 'Failed to start video thumbnail rebuilding.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to connect to backend.', type: 'error' });
    } finally {
      setIsTriggeringRebuildThumbnails(false);
    }
  };

  // Refresh cache stats whenever settings modal opens or rebuild completes
  useEffect(() => {
    if (isSettingsOpen) {
      fetchCacheStats();
    }
  }, [isSettingsOpen, status.is_rebuilding_video_thumbnails, fetchCacheStats]);

  return {
    cacheStats,
    isClearingThumbnails,
    showConfirmClearThumbnails,
    setShowConfirmClearThumbnails,
    isTriggeringRebuildThumbnails,
    handleClearThumbnailCache,
    handleRebuildVideoThumbnails
  };
};
