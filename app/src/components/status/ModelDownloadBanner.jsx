import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatBytes, formatDuration } from '../../utils/formatters';

export const ModelDownloadBanner = ({ status, pendingModel, handleCancelDownload }) => {
  if (!(status.is_downloading)) return null;

  return (
    <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
      <div className="bg-gradient-to-r from-emerald-500/5 to-transparent dark:from-emerald-500/10 dark:to-transparent border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 flex flex-col gap-2 relative text-emerald-700 dark:text-emerald-300">
        <div className="flex justify-between items-center text-sm font-bold">
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>
              {status.is_loading_model
                ? "Finalizing & Loading AI Vision Engine..."
                : (status.download_total_bytes > 0 && status.download_current_bytes >= status.download_total_bytes)
                  ? "Verifying & Finalizing download..."
                  : `Downloading AI Vision Engine: ${pendingModel.split('/').pop()}`}
            </span>
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancelDownload}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded border transition-all font-bold uppercase",
                status.cancel_download
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-500 animate-pulse cursor-default font-extrabold"
                  : "bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 border-gray-200 dark:border-neutral-700 shadow-sm dark:shadow-none"
              )}
              disabled={status.cancel_download}
            >
              {status.cancel_download ? 'Cancelling...' : 'Cancel'}
            </button>
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {status.is_loading_model
                ? '99%'
                : status.download_total_bytes > 0
                  ? `${Math.round((status.download_current_bytes / status.download_total_bytes) * 100)}%`
                  : 'Starting...'}
            </span>
          </div>
        </div>

        <div className="w-full h-1.5 bg-gray-100 dark:bg-neutral-900 rounded-full overflow-hidden">
          <div
            className="terminal-progress-fill h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
            style={{
              width: status.is_loading_model
                ? '99.5%'
                : status.download_total_bytes > 0
                  ? `${(status.download_current_bytes / status.download_total_bytes) * 100}%`
                  : '0%'
            }}
          />
        </div>

        {!status.is_loading_model && (
          <div className="flex justify-between items-center mt-1">
            <div className="flex gap-4">
              <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                Size: {formatBytes(status.download_current_bytes)} / {formatBytes(status.download_total_bytes)}
              </span>
              {status.download_current_bytes < status.download_total_bytes && (
                <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                  Speed: {formatBytes(status.download_speed)}/s
                </span>
              )}
            </div>
            {status.download_current_bytes < status.download_total_bytes && (
              <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                ETA: {formatDuration(status.download_eta)}
              </span>
            )}
          </div>
        )}

        {status.is_loading_model && (
          <div className="mt-1">
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">
              Warming up tensors in memory...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
