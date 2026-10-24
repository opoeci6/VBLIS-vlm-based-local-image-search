import { Loader2, CheckCircle2, Trash2, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatBytes } from '../../utils/formatters';

export const ModelCard = ({ m, models, status, pendingModel, uiTheme, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel }) => {
  const isActive = models.active_model === m.id;
  const isDownloading = status.is_downloading && pendingModel === m.id;

  return (
    <div
      className={cn(
        "group flex flex-col p-4 border rounded-xl transition-all duration-200",
        isActive
          ? (uiTheme === 'modern'
              ? "bg-indigo-50/80 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/40 ring-1 ring-indigo-500/20 shadow-sm"
              : "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/50 ring-1 ring-indigo-500/10 dark:ring-indigo-500/20")
          : "bg-gray-50 dark:bg-neutral-800/30 border-gray-100 dark:border-neutral-800 hover:bg-gray-100 dark:hover:bg-neutral-800/50"
      )}
    >
      <div className="flex items-center justify-between gap-5">
        <div className="min-w-0 flex-1">
          <span
            className={cn("block truncate whitespace-nowrap text-sm font-semibold", isActive ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-700 dark:text-neutral-200")}
            title={m.id}
          >
            {m.id.split('/').pop()}
          </span>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={cn(
              "text-[10px] uppercase tracking-wider font-bold whitespace-nowrap flex items-center gap-1",
              m.downloaded ? "text-emerald-500/90 dark:text-emerald-400" : (isDownloading || m.incomplete) ? "text-amber-500 font-extrabold" : "text-neutral-400"
            )}>
              {m.downloaded
                ? "Ready to use"
                : isDownloading
                  ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      Downloading ({formatBytes(status.download_current_bytes)} / {formatBytes(status.download_total_bytes || m.download_total_bytes)})
                    </span>
                  )
                  : m.incomplete
                    ? (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        Incomplete ({formatBytes(m.download_current_bytes)} / {formatBytes(m.download_total_bytes)})
                      </span>
                    )
                    : "Not Downloaded"}
            </span>
            {isActive && (
              uiTheme === 'modern' ? (
                <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-500/30">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Active
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 py-0.5 border border-white text-[9px] uppercase tracking-wider font-extrabold whitespace-nowrap">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Active
                </span>
              )
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Action Buttons: Activate or Checkmark */}
          {isActive ? (
            <button
              onClick={handleUnloadModel}
              disabled={isUnloadingModel || status.is_indexing}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50",
                uiTheme === 'modern'
                  ? "bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-xl hover:scale-105 active:scale-95"
                  : "border border-rose-500 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
              )}
              title={status.is_indexing ? "Cannot eject model while indexing is in progress" : "Unload model to free GPU VRAM"}
            >
              <LogOut className="w-3.5 h-3.5" />
              {isUnloadingModel ? "Unloading..." : "Eject"}
            </button>
          ) : m.downloaded ? (
            <button
              onClick={() => handleModelSwitch(m.id)}
              disabled={isSwitchingModel || status.is_downloading || status.is_indexing}
              className={cn(
                "text-xs px-3.5 py-1.5 font-bold transition-all disabled:opacity-50 shadow-sm cursor-pointer",
                uiTheme === 'modern'
                  ? "bg-gray-100 dark:bg-neutral-800 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 text-neutral-800 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700 hover:border-indigo-600 hover:scale-105 active:scale-95"
                  : "border border-white bg-black text-white"
              )}
              title={status.is_indexing ? "Cannot switch model while indexing is in progress" : "Activate model"}
            >
              {isSwitchingModel && pendingModel === m.id ? "..." : "Activate"}
            </button>
          ) : isDownloading ? (
            <div
              className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 cursor-default"
            >
              <div className="flex flex-col items-end min-w-[120px]">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[10px] font-bold uppercase">Downloading...</span>
                </div>
                {status.download_total_bytes > 0 && (
                  <div className="flex flex-col w-full gap-1.5 mt-1.5">
                    <div className="terminal-progress-track w-full h-1.5 bg-gray-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="terminal-progress-fill h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${(status.download_current_bytes / status.download_total_bytes) * 100}%` }}
                      />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelDownload();
                      }}
                      className={cn(
                        "text-[9px] font-bold uppercase self-end transition-colors transition-all",
                        status.cancel_download
                          ? "text-rose-500 animate-pulse cursor-default"
                          : "text-neutral-400 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                      )}
                      disabled={status.cancel_download}
                    >
                      {status.cancel_download ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </div>
                )}
                <span className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-0.5 font-mono">
                  {formatBytes(status.download_speed)}/s
                </span>
              </div>
            </div>
          ) : m.incomplete ? (
            <button
              onClick={() => {
                setPendingModel(m.id);
                handleDownloadModel(m.id);
              }}
              disabled={status.is_downloading}
              className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 shadow-sm"
              title="Resume interrupted download"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Resume
            </button>
          ) : (
            <button
              onClick={() => {
                setPendingModel(m.id);
                handleDownloadModel(m.id);
              }}
              disabled={status.is_downloading}
              className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            >
              Download
            </button>
          )}

          {/* Delete Action (Visible for any downloaded or incomplete model when NOT downloading or indexing) */}
          {(m.downloaded || m.incomplete) && !isDownloading && !status.is_indexing && (
            <div className="relative ml-1">
              {showConfirmDeleteModel === m.id ? (
                <div className="flex flex-col items-end gap-1 animate-in slide-in-from-right-2 duration-200">
                  {/* Only show "Wipe Index" checkbox for fully downloaded models that could have been used */}
                  {m.downloaded && (
                    <label className="flex items-center gap-1.5 cursor-pointer group/check mb-1">
                      <input
                        type="checkbox"
                        checked={deleteIndexWithModel}
                        onChange={(e) => setDeleteIndexWithModel(e.target.checked)}
                        className="w-2.5 h-2.5 rounded border-neutral-700 bg-neutral-800 text-rose-500 focus:ring-rose-500/20"
                      />
                      <span className="text-[9px] text-neutral-500 group-hover/check:text-neutral-300 transition-colors">Wipe Index</span>
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeleteModel(m.id)}
                      disabled={isDeletingModel}
                      className="text-[9px] px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold uppercase transition-colors"
                    >
                      {isDeletingModel ? "..." : "Del"}
                    </button>
                    <button
                      onClick={() => setShowConfirmDeleteModel(null)}
                      className="text-[9px] px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white rounded font-bold uppercase transition-colors"
                    >
                      X
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirmDeleteModel(m.id)}
                  className="p-2 text-neutral-500 hover:text-rose-400 transition-colors"
                  title={m.incomplete ? "Delete partial files" : "Delete local files"}
                >
                  <Trash2 className="w-4 h-4 text-rose-500/80 hover:text-rose-500" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
