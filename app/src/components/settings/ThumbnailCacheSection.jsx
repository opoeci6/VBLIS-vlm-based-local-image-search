import { Loader2, Image as ImageIcon, Trash2, RefreshCw, Video } from 'lucide-react';

export const ThumbnailCacheSection = ({ cacheStats, showConfirmClearThumbnails, setShowConfirmClearThumbnails, handleClearThumbnailCache, isClearingThumbnails, status, handleRebuildVideoThumbnails, isTriggeringRebuildThumbnails }) => {
  return (
    <div className="pt-4 mt-2 border-t border-gray-100 dark:border-neutral-800 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Thumbnail Cache Management</h4>
        <span className="text-[11px] font-mono font-medium text-neutral-400 dark:text-neutral-500">Total: {cacheStats.total.formatted}</span>
      </div>

      {/* Image Thumbnails Card */}
      <div className="p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">Image Thumbnails</span>
          </div>
          <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-md text-[11px] font-mono font-semibold border border-indigo-100 dark:border-indigo-500/20">
            {cacheStats.images.formatted} · {cacheStats.images.count} items
          </span>
        </div>

        {showConfirmClearThumbnails === 'images' ? (
          <div className="p-3 bg-white dark:bg-neutral-900 border border-indigo-200 dark:border-indigo-500/30 rounded-xl space-y-2 animate-in zoom-in-95 duration-150">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Clear all image thumbnails? (Images regenerate quickly on demand)</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleClearThumbnailCache('images')}
                disabled={isClearingThumbnails}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-xs font-bold flex justify-center items-center gap-1.5 transition-colors"
              >
                {isClearingThumbnails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Yes, Clear Images</span>
              </button>
              <button
                onClick={() => setShowConfirmClearThumbnails(null)}
                disabled={isClearingThumbnails}
                className="flex-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-1.5 text-xs font-bold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmClearThumbnails('images')}
            disabled={isClearingThumbnails || cacheStats.images.count === 0}
            className="w-full px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-indigo-200/70 dark:border-indigo-500/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Image Cache</span>
          </button>
        )}
      </div>

      {/* Video Keyframes Card */}
      <div className="p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-500" />
            <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">Video Keyframes</span>
          </div>
          <span className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-md text-[11px] font-mono font-semibold border border-cyan-100 dark:border-cyan-500/20">
            {cacheStats.videos.formatted} · {cacheStats.videos.count} frames
          </span>
        </div>

        {status.is_rebuilding_video_thumbnails ? (
          <div className="p-3.5 bg-cyan-50/70 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs font-bold text-cyan-700 dark:text-cyan-300">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                Rebuilding Video Thumbnails...
              </span>
              <span>
                {status.total_video_frames_to_rebuild > 0
                  ? `${Math.round((status.rebuilt_video_frames / status.total_video_frames_to_rebuild) * 100)}%`
                  : 'Starting...'}
              </span>
            </div>

            <div className="terminal-progress-track w-full bg-cyan-200/50 dark:bg-cyan-900/40 rounded-full h-2.5 overflow-hidden">
              <div
                className="terminal-progress-fill bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${status.total_video_frames_to_rebuild > 0 ? Math.min(100, Math.round((status.rebuilt_video_frames / status.total_video_frames_to_rebuild) * 100)) : 8}%`
                }}
              />
            </div>

            <div className="flex justify-between items-center text-[10px] text-cyan-600/80 dark:text-cyan-400/80 font-mono">
              <span>{status.rebuilt_video_frames} of {status.total_video_frames_to_rebuild || '?'} frames cached</span>
              <span className="animate-pulse">Active</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {showConfirmClearThumbnails === 'videos' ? (
              <div className="w-full p-3 bg-white dark:bg-neutral-900 border border-cyan-200 dark:border-cyan-500/30 rounded-xl space-y-2 animate-in zoom-in-95 duration-150">
                <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Clear video thumbnails? (Requires video decoding to recreate)</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleClearThumbnailCache('videos')}
                    disabled={isClearingThumbnails}
                    className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg py-1.5 text-xs font-bold flex justify-center items-center gap-1.5 transition-colors"
                  >
                    {isClearingThumbnails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    <span>Yes, Clear Videos</span>
                  </button>
                  <button
                    onClick={() => setShowConfirmClearThumbnails(null)}
                    disabled={isClearingThumbnails}
                    className="flex-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-1.5 text-xs font-bold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={handleRebuildVideoThumbnails}
                  disabled={status.is_indexing || isTriggeringRebuildThumbnails}
                  className="flex-1 px-3 py-2 bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-cyan-200/70 dark:border-cyan-500/20"
                >
                  {isTriggeringRebuildThumbnails ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Rebuild Videos</span>
                </button>
                <button
                  onClick={() => setShowConfirmClearThumbnails('videos')}
                  disabled={isClearingThumbnails || cacheStats.videos.count === 0}
                  className="px-3 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-neutral-600 dark:text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-gray-200/80 dark:border-neutral-700"
                  title="Clear only video thumbnails"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
