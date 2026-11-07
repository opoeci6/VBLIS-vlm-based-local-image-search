import { useRef, useEffect } from 'react';
import { API_BASE } from '../config';
import { getMediaPreviewUrl } from '../utils/media';

export const useProgressiveList = ({ items, visibleCount, setVisibleCount }) => {
  const sentinelRef = useRef(null);
  const sentinelTerminalRef = useRef(null);


  // Background Prefetcher: Quietly prefetch the next 80 image thumbnails in browser idle time
  useEffect(() => {
    if (items.length <= visibleCount) return;
    const nextBatch = items.slice(visibleCount, visibleCount + 80);
    const prefetchTimer = setTimeout(() => {
      nextBatch.forEach(item => {
        const url = getMediaPreviewUrl(API_BASE, item, 'thumbnail');
        const img = new window.Image();
        img.src = url;
      });
    }, 150);

    return () => clearTimeout(prefetchTimer);
  }, [items, visibleCount]);

  // Seamless Infinite Scroll: Auto-expands visibleCount when scrolling near bottom
  useEffect(() => {
    if (items.length <= visibleCount) return;
    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries.some(e => e.isIntersecting);
      if (isVisible) {
        setVisibleCount(prev => Math.min(prev + 80, items.length));
      }
    }, {
      root: null,
      rootMargin: '500px', // Pre-trigger 500px before reaching bottom
      threshold: 0.01
    });

    if (sentinelRef.current) observer.observe(sentinelRef.current);
    if (sentinelTerminalRef.current) observer.observe(sentinelTerminalRef.current);

    return () => observer.disconnect();
  }, [items.length, visibleCount, setVisibleCount]);

  return { sentinelRef, sentinelTerminalRef };
};
