import { memo } from 'react';
import { FolderOpen, Loader2, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { FolderContentRow } from './FolderContentRow';
import { cn } from '../../utils/cn';

export const FolderContentsModal = memo(function FolderContentsModal({ showFolderContents, browsingFolder, folderContents, isFetchingFolderContents, isCleaningGhostRecords, setIsCleaningGhostRecords, folderVisibleLimit, setFolderVisibleLimit, handleCloseFolderContents, handleReindexFolder, setSelectedImage, setToast, uiTheme }) {
  if (!(showFolderContents && browsingFolder)) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={handleCloseFolderContents}
    >
      <div
        className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-3xl w-[820px] max-w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-100 dark:border-neutral-800 flex items-start justify-between bg-gray-50/50 dark:bg-neutral-900/50">
          <div className="min-w-0 pr-6">
            <div className="flex items-center gap-3">
              <div className="icon-tile w-10 h-10 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-xl flex items-center justify-center ring-1 ring-cyan-200 dark:ring-cyan-500/20 flex-shrink-0">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Folder Contents</h2>
                <p className="text-xs text-neutral-500 font-mono truncate mt-1" title={browsingFolder.path}>
                  {browsingFolder.path}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={handleCloseFolderContents}
            className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {folderContents && (
          <div className="px-6 py-3 border-b border-gray-100 dark:border-neutral-800 flex flex-wrap items-center gap-2 bg-gray-50/40 dark:bg-neutral-800/20">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
              {folderContents.image_count} images
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-xs font-bold">
              {folderContents.video_count} videos
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-bold border border-emerald-200/60 dark:border-emerald-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              {folderContents.indexed_count || 0} indexed
            </span>
            {(folderContents.unindexed_count > 0) && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-bold border border-amber-200/60 dark:border-amber-500/30">
                {folderContents.unindexed_count} unindexed
              </span>
            )}
            {(folderContents.missing_on_disk_count > 0) && (
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-bold border border-rose-200/60 dark:border-rose-500/30 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-rose-500" />
                  {folderContents.missing_on_disk_count} missing from disk
                </span>
                <button
                  type="button"
                  disabled={isCleaningGhostRecords}
                  onClick={async () => {
                    setIsCleaningGhostRecords(true);
                    try {
                      await handleReindexFolder(browsingFolder.path);
                    } finally {
                      setIsCleaningGhostRecords(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                  title="Clean ghost records by re-syncing this folder"
                >
                  <RefreshCw className={cn("w-3 h-3", isCleaningGhostRecords && "animate-spin")} />
                  {isCleaningGhostRecords ? "Cleaning..." : "Clean Ghost Records"}
                </button>
              </div>
            )}
            <span className="text-xs text-neutral-500 ml-auto">
              {folderContents.total_count} total files
            </span>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto p-4 custom-scrollbar"
          onScroll={(e) => {
            const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
            if (scrollHeight - scrollTop - clientHeight < 300) {
              setFolderVisibleLimit(prev => Math.min(prev + 40, folderContents?.items?.length || prev));
            }
          }}
        >
          {isFetchingFolderContents ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
              <p className="text-sm text-neutral-500">Scanning folder contents...</p>
            </div>
          ) : !folderContents || folderContents.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FolderOpen className="w-12 h-12 text-neutral-300 dark:text-neutral-700 mb-4" />
              <h3 className="text-base font-bold text-neutral-700 dark:text-neutral-300">No supported media found</h3>
              <p className="text-sm text-neutral-500 mt-2">This folder does not contain supported image or video files.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {folderContents.truncated && (
                <div className="p-3 mb-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                  Showing the first {folderContents.limit} files. The folder contains more supported media.
                </div>
              )}

              {folderContents.items.slice(0, folderVisibleLimit).map((item) => (
                <FolderContentRow key={item.path} item={item} uiTheme={uiTheme} setSelectedImage={setSelectedImage} setToast={setToast} />
              ))}

              {folderVisibleLimit < folderContents.items.length && (
                <div className="py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setFolderVisibleLimit(prev => Math.min(prev + 100, folderContents.items.length))}
                    className={cn(
                      "text-xs font-bold px-4 py-1.5 rounded-xl border transition-all",
                      uiTheme === 'modern'
                        ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-100"
                        : "border border-white text-white"
                    )}
                  >
                    Load more ({folderContents.items.length - folderVisibleLimit} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
  );
});
