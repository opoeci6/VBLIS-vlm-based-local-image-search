import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronLeft, ChevronRight, FolderOpen, X, Sparkles, Copy, ClipboardCopy, MapPin, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../config';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cn } from '../../utils/cn';
import { copyText, openInExplorer } from '../../utils/electron';
import { formatBytes, formatTakenDate, formatVideoTimestamp } from '../../utils/formatters';
import { decideSwipe, lightboxPosition, mediaKey, nextItem, previousItem } from '../../utils/lightboxNav';
import { getMediaPreviewUrl } from '../../utils/media';
import { startPlayback } from '../../utils/originals';
import { OriginalVideoPlayer } from './OriginalVideoPlayer';
import { formatPlaceLine } from '../../utils/placeNames';
import { formatScorePercent, hasScore, isSimilarityKind } from '../../utils/scoreLabel';
import { OriginalLinks } from './OriginalLinks';

// A tap that ends a swipe can still produce a click; it must not reach the backdrop and close the view.
const SWIPE_CLICK_GUARD_MS = 400;

const isTypingTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
};

// Look shared by the toolbar buttons. min-h-10 / min-w-10 keep every tap target at 40 px or more.
const TOOLBAR_BUTTON = "min-h-10 px-4 py-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl flex items-center gap-2 transition-all font-bold backdrop-blur-md border border-white/20 dark:border-neutral-700";

// Previous / next: a button in the toolbar row on a phone, a large round button at the screen edge from sm up.
const NAV_BUTTON = "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/20 text-white transition-all disabled:cursor-default disabled:opacity-30 sm:fixed sm:top-1/2 sm:z-[90] sm:h-12 sm:w-12 sm:-translate-y-1/2 sm:rounded-full sm:bg-black/40 sm:backdrop-blur-md";

/**
 * Full-screen view of one picture. `navItems` is the list it walks (previous / next, arrow keys, swipe); the
 * picture must be in it, and an item opened from the folder window (`isBrowsing`) has no navigation.
 */
export const MediaLightbox = ({ selectedImage, setSelectedImage, setToast, uiTheme, navItems }) => {
  // `i18n` is destructured too: it re-renders on a language switch, and the place line is named in that language.
  const { t, i18n } = useTranslation('media');
  const isOpen = Boolean(selectedImage);
  const close = useCallback(() => setSelectedImage(null), [setSelectedImage]);
  const backdropDismiss = useBackdropDismiss(close);
  // On a phone, Back closes the view. Keyed on open/closed only: moving to another picture adds no history entry.
  useBackToClose(isOpen, close);

  // Playing the original video in place of the picture: 'idle' (picture, Play video offered), 'playing' or
  // 'failed' (picture again, with a message). Reset when another item is shown.
  const [play, setPlay] = useState('idle');
  const playerRef = useRef(null);
  const shownKey = selectedImage ? mediaKey(selectedImage) : null;
  const [playKey, setPlayKey] = useState(shownKey);
  if (shownKey !== playKey) {
    setPlayKey(shownKey);
    setPlay('idle');
  }

  const nav = useMemo(() => {
    if (!selectedImage || selectedImage.isBrowsing) return null;
    const position = lightboxPosition(navItems, selectedImage);
    if (!position || position.total < 2) return null;
    return {
      position,
      previous: previousItem(navItems, selectedImage),
      next: nextItem(navItems, selectedImage),
    };
  }, [navItems, selectedImage]);
  const previous = nav?.previous ?? null;
  const next = nav?.next ?? null;
  const hasNav = nav !== null;

  // Esc closes this view when it is the top one (the shared stack in useEscapeKey).
  useEscapeKey(isOpen, close);

  // Arrow keys move. Capture phase and stopped, so nothing under the lightbox also reacts to them.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      // The video player's own keys (seeking) win while it has the focus.
      if (event.target?.closest?.('video')) return;
      let handle;
      if (hasNav && event.key === 'ArrowLeft') {
        handle = () => { if (previous) setSelectedImage(previous); };
      } else if (hasNav && event.key === 'ArrowRight') {
        handle = () => { if (next) setSelectedImage(next); };
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handle();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, hasNav, previous, next, setSelectedImage]);

  // Load the next picture ahead of time so a swipe or arrow shows it at once.
  useEffect(() => {
    if (!next) return;
    const preload = new Image();
    preload.src = getMediaPreviewUrl(API_BASE, next, 'full');
  }, [next]);

  // Swipe: touch pointers only (a mouse drag is not a swipe). One finger down to up counts; a second finger
  // (pinch) cancels the gesture.
  const touchesRef = useRef(new Set());
  const gestureRef = useRef(null);
  const swallowClicksUntilRef = useRef(0);
  useEffect(() => {
    if (!isOpen) return undefined;
    const touches = touchesRef.current;
    return () => {
      touches.clear();
      gestureRef.current = null;
    };
  }, [isOpen]);

  if (!(selectedImage)) return null;

  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch') return;
    // A finger on the player scrubs the timeline; it is not a swipe.
    if (event.target?.closest?.('video')) return;
    const touches = touchesRef.current;
    touches.add(event.pointerId);
    gestureRef.current = touches.size === 1
      ? { x: event.clientX, y: event.clientY, time: event.timeStamp, cancelled: false }
      : { ...gestureRef.current, cancelled: true };
  };

  const endTouch = (event, mayBeSwipe) => {
    if (event.pointerType !== 'touch') return;
    const touches = touchesRef.current;
    if (!touches.has(event.pointerId)) return;
    const gesture = gestureRef.current;
    const pointerCount = touches.size;
    touches.delete(event.pointerId);
    if (touches.size === 0) gestureRef.current = null;
    if (!mayBeSwipe || !hasNav || !gesture || gesture.cancelled) return;
    const direction = decideSwipe({
      dx: event.clientX - gesture.x,
      dy: event.clientY - gesture.y,
      dt: event.timeStamp - gesture.time,
      pointerCount,
      viewportScale: window.visualViewport?.scale ?? 1,
    });
    if (!direction) return;
    swallowClicksUntilRef.current = Date.now() + SWIPE_CLICK_GUARD_MS;
    const target = direction === 'next' ? next : previous;
    if (target) setSelectedImage(target);
  };

  const onClickCapture = (event) => {
    if (Date.now() < swallowClicksUntilRef.current) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  // Other locations are links that reveal the file in Explorer. A browser has no Explorer: plain text there.
  const canShowInExplorer = Boolean(window.electronAPI?.openInExplorer);
  // An item from the library view (no query) has no score: show when it was taken instead.
  const takenDate = formatTakenDate(selectedImage.taken_at);
  // Search and library results carry `place` when the file has GPS data; folder explorer items never do.
  const placeLine = formatPlaceLine(selectedImage.place, i18n.language);
  const duplicateNotice = selectedImage.isDuplicate
    ? (selectedImage.duplicateType === 'exact'
      ? t('lightbox.exactDetected', { count: selectedImage.otherPaths.length })
      : t('lightbox.visualDetected', { count: selectedImage.otherPaths.length }))
    : null;

  // The picture and the player (poster) share the preview and the sizing.
  const previewUrl = getMediaPreviewUrl(API_BASE, selectedImage, 'full');
  const previewClassName = cn(
    "w-full max-w-full object-contain rounded-none shadow-2xl animate-in zoom-in-95 duration-300 sm:w-auto sm:rounded-lg",
    selectedImage.isDuplicate ? "max-h-[calc(100dvh-8rem)] sm:max-h-[70dvh]" : "max-h-[calc(100dvh-8rem)] sm:max-h-[80dvh]"
  );

  const handleCopyPath = async (e) => {
    e.stopPropagation();
    const res = await copyText(selectedImage.path);
    if (res?.success) {
      setToast({ message: t('lightbox.pathCopied'), type: 'success' });
    } else {
      setToast({ message: res?.error || t('lightbox.copyFailed'), type: 'error' });
    }
  };

  return (
    <div
      className={cn(
        "app-overlay fixed inset-0 z-[80] flex flex-col items-center justify-start sm:justify-center bg-black/90 px-safe pb-safe sm:p-6 sm:py-8 overflow-y-auto touch-pan-y touch-pinch-zoom animate-in fade-in duration-200 custom-scrollbar",
        // A playing video would make the page behind be blurred again on every frame.
        play !== 'playing' && "backdrop-blur-md",
        hasNav && "sm:px-16"
      )}
      {...backdropDismiss}
      onPointerDown={onPointerDown}
      onPointerUp={(event) => endTouch(event, true)}
      onPointerCancel={(event) => endTouch(event, false)}
      onClickCapture={onClickCapture}
    >
      {/* A row at the top on a phone (kept in view while the page scrolls); from sm up it floats at the top right. */}
      <div className="sticky top-0 z-[90] w-full bg-black/70 pt-safe backdrop-blur-md sm:fixed sm:right-6 sm:top-12 sm:w-auto sm:bg-transparent sm:pt-0 sm:backdrop-blur-none">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:justify-end sm:gap-4 sm:p-0">
          {hasNav && (
            <div className="flex items-center gap-1 sm:contents">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (previous) setSelectedImage(previous);
                }}
                disabled={!previous}
                aria-label={t('lightbox.previous')}
                className={cn(NAV_BUTTON, "sm:left-3")}
              >
                <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
              </button>
              <span
                className="flex min-h-10 min-w-[4.5rem] items-center justify-center px-2 text-sm font-bold tabular-nums text-white sm:rounded-xl sm:bg-black/40 sm:px-4"
                aria-live="polite"
              >
                {t('lightbox.position', { current: nav.position.index + 1, total: nav.position.total })}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (next) setSelectedImage(next);
                }}
                disabled={!next}
                aria-label={t('lightbox.next')}
                className={cn(NAV_BUTTON, "sm:right-3")}
              >
                <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
              </button>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            aria-label={t('common:close')}
            className="ml-auto flex min-h-10 min-w-10 items-center justify-center p-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl transition-all backdrop-blur-md border border-white/20 dark:border-neutral-700 sm:order-last sm:ml-0"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Second row on a phone; inline before Close from sm up. Empty (hidden) when there is nothing to show. */}
          <div className="order-last flex basis-full flex-wrap items-center gap-2 empty:hidden sm:order-none sm:basis-auto sm:gap-4">
            {window.electronAPI && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const res = await window.electronAPI.openInExplorer(selectedImage.path);
                  if (res && !res.success) {
                    setToast({ message: t('lightbox.unavailable'), type: 'error' });
                  }
                }}
                className={TOOLBAR_BUTTON}
              >
                <FolderOpen className="w-4 h-4" />
                {t('common:showInExplorer')}
              </button>
            )}
            <OriginalLinks
              path={selectedImage.path}
              mediaType={selectedImage.media_type}
              onClick={(e) => e.stopPropagation()}
              onPlay={selectedImage.media_type === 'video' && play === 'idle' ? () => {
                // Mounted within the tap, so it can start with sound there (see startPlayback).
                flushSync(() => setPlay('playing'));
                startPlayback(playerRef.current);
              } : undefined}
              className={TOOLBAR_BUTTON}
            />
          </div>
        </div>
      </div>

      {selectedImage.media_type === 'video' && play === 'playing' ? (
        <OriginalVideoPlayer
          ref={playerRef}
          path={selectedImage.path}
          start={selectedImage.timestamp_seconds}
          poster={previewUrl}
          className={previewClassName}
          onFailed={() => setPlay('failed')}
        />
      ) : (
        <img
          src={previewUrl}
          alt={selectedImage.media_type === 'video' ? t('common:videoFrameAt', { ts: formatVideoTimestamp(selectedImage.timestamp_seconds) }) : t('lightbox.fullSizeAlt')}
          className={previewClassName}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div className="mt-4 w-full px-4 pb-4 text-center sm:mt-6 sm:w-auto sm:px-0 sm:pb-0" onClick={(e) => e.stopPropagation()}>
        {play === 'failed' && (
          <p role="status" className="mb-2 text-sm font-medium text-amber-300">{t('originals.cannotPlay')}</p>
        )}
        {!selectedImage.isBrowsing && hasScore(selectedImage) && (
          <p className="text-xl font-medium text-white mb-2">
            {isSimilarityKind(selectedImage.score_kind)
              ? t('lightbox.similarityScore', { percent: formatScorePercent(selectedImage.score) })
              : t('lightbox.matchScore', { percent: formatScorePercent(selectedImage.score) })}
          </p>
        )}
        {!selectedImage.isBrowsing && !hasScore(selectedImage) && takenDate && (
          <p className="text-xl font-medium text-white mb-2">{t('lightbox.taken', { date: takenDate })}</p>
        )}
        {selectedImage.isBrowsing && (
          <div className="mb-2">
            <p className="text-xl font-medium text-white truncate max-w-3xl px-4 mx-auto" title={selectedImage.name || selectedImage.path}>
              {selectedImage.name || selectedImage.path?.split('\\').pop().split('/').pop()}
            </p>
            {selectedImage.size ? (
              <p className="text-xs text-neutral-400 font-mono mt-0.5">{formatBytes(selectedImage.size)}</p>
            ) : null}
          </div>
        )}
        {placeLine && (
          <p
            className="mb-2 flex items-center justify-center gap-1.5 px-4 text-sm text-neutral-300"
            title={t('lightbox.place', { place: placeLine })}
          >
            <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>{placeLine}</span>
          </p>
        )}
        {selectedImage.media_type === 'video' && (
          <p className={cn(
            "mb-3 inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold",
            uiTheme === 'modern'
              ? "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 rounded-full backdrop-blur-md shadow-lg"
              : "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300"
          )}>
            <Video className="w-4 h-4" />
            {t('common:videoFrameAt', { ts: formatVideoTimestamp(selectedImage.timestamp_seconds) })}
          </p>
        )}
        {selectedImage.isDuplicate && (
          uiTheme === 'modern' ? (
            <div 
              className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold animate-in zoom-in-95 duration-300 shadow-xl border backdrop-blur-md"
              style={{ 
                backgroundColor: `${selectedImage.dupeColor || '#6366f1'}25`,
                borderColor: `${selectedImage.dupeColor || '#6366f1'}60`,
                color: selectedImage.dupeColor || '#a5b4fc',
                boxShadow: `0 0 20px -5px ${selectedImage.dupeColor || '#6366f1'}40`
              }}
            >
              {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>
                {duplicateNotice}
              </span>
            </div>
          ) : (
            <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 bg-black border border-white text-white rounded-none text-xs font-bold animate-in zoom-in-95 duration-300 shadow-lg">
              {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>
                {duplicateNotice}
              </span>
            </div>
          )
        )}
        <div className="flex items-start justify-center gap-2 max-w-3xl mx-auto">
          <p className={cn(
            "text-xs break-all min-w-0",
            uiTheme === 'modern' ? "text-neutral-300 font-sans" : "text-neutral-400 font-mono"
          )}>
            {selectedImage.path}
          </p>
          <button
            type="button"
            onClick={handleCopyPath}
            aria-label={t('lightbox.copyPath')}
            title={t('lightbox.copyPath')}
            className={cn(
              // 24 px to see; on a phone an invisible 8 px margin makes it a 40 px tap target
              "relative flex-shrink-0 p-1 transition-all max-sm:before:absolute max-sm:before:-inset-2",
              uiTheme === 'modern'
                ? "rounded-md bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white border border-white/15"
                : "rounded-none bg-black border border-white text-white font-mono hover:bg-white hover:text-black"
            )}
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
          </button>
        </div>
        {selectedImage.isDuplicate && (
          <div className="mt-2 space-y-1.5">
            {selectedImage.otherPaths.map(p => (
              <div
                key={p}
                className={cn(
                  "text-[11px] break-all max-w-2xl mx-auto flex items-center justify-center gap-1.5 flex-wrap",
                  uiTheme === 'modern' ? "text-neutral-400 font-sans" : "text-neutral-400 font-mono"
                )}
              >
                <span className="opacity-75">{t('lightbox.alsoFoundAt')}</span>
                {canShowInExplorer ? (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (window.electronAPI?.openInExplorer) {
                        const res = await openInExplorer(p);
                        if (!res?.success) {
                          setToast({ type: 'error', message: res?.error || t('common:openFileFailed') });
                        }
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 cursor-pointer transition-all break-all text-left group",
                      uiTheme === 'modern'
                        ? "text-indigo-300 hover:text-indigo-200 underline underline-offset-2 hover:opacity-100 opacity-90"
                        : "text-white hover:underline underline-offset-2"
                    )}
                    title={t('lightbox.showPathInExplorer', { path: p })}
                  >
                    <FolderOpen className="w-3 h-3 flex-shrink-0 inline group-hover:scale-110 transition-transform" />
                    <span>{p}</span>
                  </button>
                ) : (
                  <span className="break-all">{p}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
