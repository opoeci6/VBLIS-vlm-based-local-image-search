import { AlertTriangle, X, RefreshCw } from 'lucide-react';

export const ModelLoadErrorBanner = ({ modelLoadError, setModelLoadError, status, pendingModel, setPendingModel, handleDownloadModel }) => {
  if (!(modelLoadError && !status.is_downloading)) return null;

  return (
    <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
      <div className="bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent border border-rose-500/30 dark:border-rose-500/20 rounded-2xl p-4 flex flex-col gap-3 relative text-rose-800 dark:text-rose-200 shadow-sm">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="icon-tile w-9 h-9 bg-rose-100 dark:bg-rose-500/20 rounded-xl flex items-center justify-center flex-shrink-0 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                Model Failed to Load: {modelLoadError.model ? modelLoadError.model.split('/').pop() : 'Vision Model'}
              </h3>
              <p className="text-xs text-rose-700/80 dark:text-rose-300/80 font-medium">
                The vision model weights or configuration could not be initialized into memory.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const targetModel = modelLoadError.model || pendingModel;
                setModelLoadError(null);
                setPendingModel(targetModel);
                handleDownloadModel(targetModel);
              }}
              className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry / Resume
            </button>
            <button
              onClick={() => setModelLoadError(null)}
              className="p-1.5 text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 rounded-lg transition-colors cursor-pointer"
              title="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="text-[11px] font-mono bg-white/80 dark:bg-neutral-900/60 p-2.5 rounded-xl border border-rose-200 dark:border-rose-500/20 break-all text-rose-800 dark:text-rose-300">
          {modelLoadError.message}
        </div>
      </div>
    </div>
  );
};
