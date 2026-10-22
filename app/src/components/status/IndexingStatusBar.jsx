import { Loader2, AlertTriangle, XCircle, Play, Pause } from 'lucide-react';
import { cn } from '../../utils/cn';

export const IndexingStatusBar = ({ status, queue, setToast, setShowSettings, isCancellingIndexing, handleCancelIndexing }) => {
  if (!(status.is_indexing || queue.activeTask || (queue.pendingCount > 0 && queue.workerState === 'paused'))) return null;
  const isQueuePaused = status.is_paused || queue.activeTask?.is_paused || queue.activeTask?.status === 'paused' || queue.workerState === 'paused';
  const displayTask = queue.activeTask || queue.pendingTasks[0];
  const isMissingModel = (queue.modelMismatch?.reason === 'no_model_loaded') || (!queue.activeModel && (queue.pendingCount > 0 || Boolean(queue.activeTask)));
  const isModelMismatch = queue.modelMismatch?.reason === 'model_difference';
  const progressPct = queue.activeTask ? queue.activeTask.progress : (displayTask ? displayTask.progress : Math.round(status.percent));
  const processedCount = queue.activeTask ? queue.activeTask.processed_count : (displayTask ? displayTask.processed_count : 0);
  const totalCount = queue.activeTask ? (queue.activeTask.total_count || 0) : (displayTask ? (displayTask.total_count || 0) : 0);

  return (
    <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
      <div
        className={cn(
          "border rounded-2xl p-4 flex flex-col gap-2.5 relative transition-all duration-300 shadow-sm",
          isMissingModel
            ? "bg-rose-50/80 dark:bg-rose-950/30 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-200"
            : isModelMismatch
            ? "bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-500/40 text-amber-950 dark:text-amber-200"
            : isQueuePaused
            ? "bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-200"
            : "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/20 text-indigo-900 dark:text-indigo-200"
        )}
      >
        <div className="flex justify-between items-center text-sm font-bold">
          <div className="flex items-center gap-2.5 min-w-0">
            {isMissingModel ? (
              <div className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
            ) : isModelMismatch ? (
              <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
            ) : isQueuePaused ? (
              <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                <Pause className="w-4 h-4" />
              </div>
            ) : (
              <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            <span className="truncate">
              {displayTask?.title || "Indexing Media"}
              {" "}
              <span className="font-mono text-xs opacity-75 font-normal ml-1">
                ({processedCount}/{totalCount || status.progress || 0})
              </span>
            </span>

            {isMissingModel ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-rose-200/80 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 shrink-0">
                NO MODEL LOADED
              </span>
            ) : isModelMismatch ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-500/30 shrink-0">
                MODEL MISMATCH
              </span>
            ) : isQueuePaused ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 shrink-0">
                PAUSED
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="font-mono text-xs font-bold">
              {progressPct}%
            </span>

            {/* Pause / Resume Button */}
            {isQueuePaused ? (
              <button
                onClick={() => {
                  if (isMissingModel) {
                    setToast({
                      message: 'Cannot resume queue: No AI model is currently loaded in memory. Please select a model in Settings.',
                      type: 'error'
                    });
                    setShowSettings(true);
                    return;
                  }
                  if (queue.activeTask) {
                    queue.resumeTask(queue.activeTask.id);
                  }
                  if (queue.workerState === 'paused') {
                    if (queue.modelMismatch?.reason === 'model_difference') {
                      queue.controlWorker('start', true);
                    } else {
                      queue.controlWorker('start');
                    }
                  }
                }}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                title={isModelMismatch ? `Resume and proceed with active model (${queue.modelMismatch.active_model?.split('/').pop()})` : "Resume indexing"}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isModelMismatch ? "Adopt & Resume" : "Resume"}</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (queue.activeTask) {
                    queue.pauseTask(queue.activeTask.id);
                  } else {
                    queue.controlWorker('pause_immediate');
                  }
                }}
                className="px-2.5 py-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-xs font-bold rounded-lg transition-all border border-gray-200 dark:border-neutral-700 flex items-center gap-1.5 cursor-pointer"
                title="Pause indexing"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
            )}

            {/* Cancel Button */}
            <button
              onClick={() => {
                if (queue.activeTask) {
                  queue.cancelTask(queue.activeTask.id);
                } else if (queue.pendingTasks.length > 0) {
                  queue.cancelTask(queue.pendingTasks[0].id);
                } else {
                  handleCancelIndexing();
                }
              }}
              disabled={isCancellingIndexing || status.cancel_requested}
              className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Stop and cancel current task"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>{isCancellingIndexing || status.cancel_requested ? "Cancelling..." : "Cancel"}</span>
            </button>
          </div>
        </div>

        {/* Progress Track */}
        <div className="terminal-progress-track w-full h-2 bg-gray-200 dark:bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "terminal-progress-fill h-full transition-all duration-300 ease-out",
              isMissingModel
                ? "bg-rose-500"
                : isModelMismatch || isQueuePaused
                ? "bg-amber-500"
                : "bg-gradient-to-r from-indigo-500 to-cyan-500"
            )}
            style={{ width: `${Math.min(100, Math.max(2, progressPct))}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-xs text-neutral-500 dark:text-neutral-400 font-medium pt-0.5 gap-3">
          <p className="flex-1 min-w-0 font-mono text-[11px] leading-snug" title={displayTask?.current_item || status.current_file}>
            {isMissingModel
              ? `No AI model loaded. Select a model in Settings to resume.`
              : isModelMismatch
              ? `Queued for '${queue.modelMismatch.queued_model?.split('/').pop()}', active: '${queue.modelMismatch.active_model?.split('/').pop()}'. Click Resume to adopt active model.`
              : isQueuePaused
              ? `Paused at: ${displayTask?.current_item || status.current_file || "Current item"}`
              : `Processing: ${displayTask?.current_item || status.current_file || "Preparing..."}`}
          </p>
          <button
            onClick={() => queue.setIsDrawerOpen(true)}
            className="px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 ml-2 rounded-md border border-indigo-200/50 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
          >
            View in Task Queue →
          </button>
        </div>
      </div>
    </div>
  );
};
