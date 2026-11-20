import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Images, Loader2, X } from 'lucide-react';
import { VideoFrameCard } from './VideoFrameCard';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { cn } from '../../utils/cn';
import { OriginalLinks } from '../media/OriginalLinks';
import { OriginalVideoPlayer } from '../media/OriginalVideoPlayer';
import { startPlayback } from '../../utils/originals';
import { formatScorePercent, hasScore, isSimilarityKind } from '../../utils/scoreLabel';

const INITIAL_VISIBLE_FRAMES = 60;

export const VideoGroupModal = ({ selectedVideoGroup, setSelectedVideoGroup, setSelectedImage, setToast, uiTheme, onFindMoreFrames, isFindingMoreFrames = false, canFindMoreFrames = false }) => {
  const { t } = useTranslation('search');
  // A video can have hundreds of matching frames, so the grid grows as the user scrolls.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_FRAMES);
  const [countPath, setCountPath] = useState(selectedVideoGroup?.path ?? null);
  // Playing the original video above the frames: 'idle' (Play video offered), 'playing' or 'failed' (a message).
  const [play, setPlay] = useState('idle');
  const playerRef = useRef(null);
  const groupPath = selectedVideoGroup?.path ?? null;
  if (groupPath !== countPath) {
    setCountPath(groupPath);
    setVisibleCount(INITIAL_VISIBLE_FRAMES);
    setPlay('idle');
  }
  const frames = selectedVideoGroup?.frames ?? [];
  const { sentinelRef } = useProgressiveList({ items: frames, visibleCount, setVisibleCount });

  const close = () => setSelectedVideoGroup(null);
  const backdropDismiss = useBackdropDismiss(close);
  const isOpen = Boolean(selectedVideoGroup);
  // Esc closes this view when it is the top one (the lightbox over it closes first). On a phone, Back closes it too.
  useEscapeKey(isOpen, close);
  useBackToClose(isOpen, close);

  if (!(selectedVideoGroup)) return null;

  return (
    <div
      className={cn(
        "app-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/75 dark:bg-black/85 sm:p-6 animate-in fade-in duration-200",
        // A playing video would make the page behind be blurred again on every frame.
        play !== 'playing' && "backdrop-blur-md"
      )}
      {...backdropDismiss}
    >
      <div
        className={cn(
          "flex h-dvh w-full max-w-6xl flex-col px-safe pt-safe pb-safe shadow-2xl sm:h-auto sm:max-h-[86dvh] sm:p-0",
          uiTheme === 'modern'
            ? "bg-white dark:bg-neutral-900 sm:border border-gray-200 dark:border-neutral-800 sm:rounded-3xl overflow-hidden"
            : "sm:border border-white bg-black"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cn(
          "flex flex-wrap items-start gap-x-3 gap-y-3 p-3 sm:flex-nowrap sm:gap-4 sm:p-5",
          uiTheme === 'modern' ? "border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50" : "border-b border-white"
        )}>
          <div className={cn(
            "flex h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0 items-center justify-center",
            uiTheme === 'modern' ? "rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "icon-tile border border-white text-white"
          )}>
            <FolderOpen className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={cn("text-lg sm:text-xl font-bold break-all", uiTheme === 'modern' ? "text-neutral-900 dark:text-white" : "text-white")}>{selectedVideoGroup.name}</h2>
            <p className={cn("mt-1 text-xs break-all font-mono", uiTheme === 'modern' ? "text-neutral-500 dark:text-neutral-400" : "text-white/80")}>{selectedVideoGroup.path}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold sm:mt-3">
              <span className={cn(
                "px-2.5 py-1",
                uiTheme === 'modern' ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-100 dark:border-indigo-500/20" : "border border-white text-white"
              )}>
                {selectedVideoGroup.isExpanded
                  ? t('videoGroup.matchingOf', { shown: selectedVideoGroup.frames.length, total: selectedVideoGroup.totalFrames ?? selectedVideoGroup.frames.length })
                  : t('videoGroup.returnedFrames', { count: selectedVideoGroup.frames.length })}
              </span>
              {hasScore(selectedVideoGroup.bestFrame) && (
                <span className={cn(
                  "px-2.5 py-1",
                  uiTheme === 'modern' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-500/20" : "border border-white text-emerald-400"
                )}>
                  {isSimilarityKind(selectedVideoGroup.bestFrame?.score_kind)
                    ? t('videoGroup.bestSimilarity', { percent: formatScorePercent(selectedVideoGroup.bestScore) })
                    : t('videoGroup.bestMatch', { percent: formatScorePercent(selectedVideoGroup.bestScore) })}
                </span>
              )}
            </div>
          </div>
          {/* On a phone the actions wrap onto their own row under the name; from sm up they sit in the header row. */}
          <div className="order-2 flex w-full flex-wrap gap-2 empty:hidden sm:order-none sm:contents">
            {canFindMoreFrames && !selectedVideoGroup.isExpanded && (
              <button
                onClick={() => onFindMoreFrames?.(selectedVideoGroup.path)}
                disabled={isFindingMoreFrames}
                className={cn(
                  "flex min-h-10 flex-shrink-0 items-center justify-center gap-2 px-4 py-2.5 font-bold text-xs transition-all disabled:cursor-wait disabled:opacity-60 sm:min-h-0",
                  uiTheme === 'modern'
                    ? "bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700"
                    : "border border-white text-white"
                )}
              >
                {isFindingMoreFrames ? <Loader2 className="w-4 h-4 animate-spin" /> : <Images className="w-4 h-4" />}
                {isFindingMoreFrames ? t('videoGroup.findingFrames') : t('videoGroup.findMoreFrames')}
              </button>
            )}
            {window.electronAPI && (
              <button
                onClick={async () => {
                  const response = await window.electronAPI.openInExplorer(selectedVideoGroup.path);
                  if (response && !response.success) {
                    setToast({ message: t('videoGroup.unavailable'), type: 'error' });
                  }
                }}
                className={cn(
                  "flex min-h-10 flex-shrink-0 items-center justify-center gap-2 px-4 py-2.5 font-bold text-xs transition-all sm:min-h-0",
                  uiTheme === 'modern'
                    ? "bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700"
                    : "border border-white text-white"
                )}
              >
                <FolderOpen className="w-4 h-4" />
                {t('common:showInExplorer')}
              </button>
            )}
            <OriginalLinks
              path={selectedVideoGroup.path}
              mediaType="video"
              className={cn(
                "flex min-h-10 flex-shrink-0 items-center justify-center gap-2 px-4 py-2.5 font-bold text-xs transition-all sm:min-h-0",
                uiTheme === 'modern'
                  ? "bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700"
                  : "border border-white text-white"
              )}
              onPlay={play === 'idle' ? () => {
                // Mounted within the tap, so it can start with sound there (see startPlayback).
                flushSync(() => setPlay('playing'));
                startPlayback(playerRef.current);
              } : undefined}
            />
          </div>
          <button
            onClick={close}
            className={cn(
              "order-1 flex h-10 w-10 flex-shrink-0 sm:order-none items-center justify-center transition-all",
              uiTheme === 'modern'
                ? "rounded-xl text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800"
                : "icon-tile border border-white text-white"
            )}
            aria-label={t('videoGroup.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="custom-scrollbar min-h-0 overflow-y-auto p-3 sm:p-5">
          {play === 'playing' && (
            <OriginalVideoPlayer
              ref={playerRef}
              path={selectedVideoGroup.path}
              className={cn("mb-3 sm:mb-5 w-full max-h-[50dvh] bg-black", uiTheme === 'modern' && "rounded-2xl")}
              onFailed={() => setPlay('failed')}
            />
          )}
          {play === 'failed' && (
            <p
              role="status"
              className={cn("mb-3 text-sm font-medium sm:mb-5", uiTheme === 'modern' ? "text-amber-600 dark:text-amber-300" : "text-amber-300")}
            >
              {t('media:originals.cannotPlay')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:gap-5 lg:grid-cols-3">
            {frames.slice(0, visibleCount).map((frame, index) => (
              <VideoFrameCard
                key={frame.id || `${frame.path}:${frame.timestamp_seconds || 0}:${index}`}
                frame={frame}
                index={index}
                onSelect={(f) => {
                  // The full-size view opens over the modal; the player stays mounted but must not keep playing.
                  playerRef.current?.pause?.();
                  setSelectedImage(f);
                }}
                uiTheme={uiTheme}
              />
            ))}
          </div>
          {frames.length > visibleCount && <div ref={sentinelRef} className="h-8" />}
        </div>
      </div>
    </div>
  );
};
