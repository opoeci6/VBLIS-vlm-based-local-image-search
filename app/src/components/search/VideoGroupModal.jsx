import { FolderOpen, X } from 'lucide-react';
import { VideoFrameCard } from './VideoFrameCard';
import { cn } from '../../utils/cn';

export const VideoGroupModal = ({ selectedVideoGroup, setSelectedVideoGroup, setSelectedImage, setToast, uiTheme }) => {
  if (!(selectedVideoGroup)) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 dark:bg-black/85 backdrop-blur-md p-6 animate-in fade-in duration-200"
      onClick={() => setSelectedVideoGroup(null)}
    >
      <div
        className={cn(
          "flex max-h-[86vh] w-full max-w-6xl flex-col shadow-2xl",
          uiTheme === 'modern'
            ? "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-3xl overflow-hidden"
            : "border border-white bg-black"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cn(
          "flex items-start gap-4 p-5",
          uiTheme === 'modern' ? "border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50" : "border-b border-white"
        )}>
          <div className={cn(
            "flex h-12 w-12 flex-shrink-0 items-center justify-center",
            uiTheme === 'modern' ? "rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "icon-tile border border-white text-white"
          )}>
            <FolderOpen className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={cn("text-xl font-bold break-all", uiTheme === 'modern' ? "text-neutral-900 dark:text-white" : "text-white")}>{selectedVideoGroup.name}</h2>
            <p className={cn("mt-1 text-xs break-all font-mono", uiTheme === 'modern' ? "text-neutral-500 dark:text-neutral-400" : "text-white/80")}>{selectedVideoGroup.path}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className={cn(
                "px-2.5 py-1",
                uiTheme === 'modern' ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-100 dark:border-indigo-500/20" : "border border-white text-white"
              )}>
                {selectedVideoGroup.frames.length} RETURNED FRAME{selectedVideoGroup.frames.length === 1 ? '' : 'S'}
              </span>
              <span className={cn(
                "px-2.5 py-1",
                uiTheme === 'modern' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-500/20" : "border border-white text-emerald-400"
              )}>
                BEST MATCH {Math.round(selectedVideoGroup.bestScore * 100)}%
              </span>
            </div>
          </div>
          {window.electronAPI && (
            <button
              onClick={async () => {
                const response = await window.electronAPI.openInExplorer(selectedVideoGroup.path);
                if (response && !response.success) {
                  setToast({ message: 'This video has been moved or deleted and is no longer available.', type: 'error' });
                }
              }}
              className={cn(
                "flex flex-shrink-0 items-center gap-2 px-4 py-2.5 font-bold text-xs transition-all",
                uiTheme === 'modern'
                  ? "bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700"
                  : "border border-white text-white"
              )}
            >
              <FolderOpen className="w-4 h-4" />
              Show in Explorer
            </button>
          )}
          <button
            onClick={() => setSelectedVideoGroup(null)}
            className={cn(
              "flex h-10 w-10 flex-shrink-0 items-center justify-center transition-all",
              uiTheme === 'modern'
                ? "rounded-xl text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800"
                : "icon-tile border border-white text-white"
            )}
            aria-label="Close video results"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="custom-scrollbar overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {selectedVideoGroup.frames.map((frame, index) => (
              <VideoFrameCard
                key={frame.id || `${frame.path}:${frame.timestamp_seconds || 0}:${index}`}
                frame={frame}
                index={index}
                onSelect={(f) => {
                  setSelectedImage(f);
                }}
                uiTheme={uiTheme}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
