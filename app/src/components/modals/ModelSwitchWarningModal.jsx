import { AlertTriangle, X, ShieldAlert, Layers, Trash2, CheckCircle2 } from 'lucide-react';

export const ModelSwitchWarningModal = ({
  isOpen,
  mode, // 'active_task' | 'queued_tasks'
  targetModel,
  activeTask,
  pendingCount,
  onConfirmCancelAndSwitch,
  onConfirmProceedWithQueued,
  onConfirmClearQueueAndSwitch,
  onClose,
  uiTheme = 'modern'
}) => {
  if (!isOpen) return null;
  const isModern = uiTheme === 'modern';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150" onClick={onClose}>
      <div
        className={`w-full max-w-md p-6 rounded-3xl shadow-2xl border transition-all animate-in zoom-in-95 duration-150 ${
          isModern
            ? 'bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-neutral-900 dark:text-white'
            : 'bg-black border-2 border-white text-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl border ${
                mode === 'active_task'
                  ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30'
              }`}
            >
              {mode === 'active_task' ? (
                <ShieldAlert className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">
                {mode === 'active_task' ? 'Active Task In Progress' : 'Queued Tasks Pending'}
              </h3>
              <p className="text-[11px] text-neutral-400 font-mono">
                Target: {targetModel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {mode === 'active_task' ? (
          <div className="space-y-3 mb-5">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Cannot switch models while an indexing or rebuild task is in progress. The active task must be cancelled first to prevent database corruption.
            </p>

            {activeTask && (
              <div className="p-3 bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-500/20 rounded-xl text-xs space-y-1">
                <div className="font-bold text-rose-800 dark:text-rose-200 truncate">
                  {activeTask.title}
                </div>
                <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 font-mono">
                  {activeTask.processed_count} of {activeTask.total_count || '?'} items ({activeTask.progress}%)
                </div>
              </div>
            )}

            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              If cancelled, this task will be saved in your task history and can be reset or retried anytime.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-5">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Each AI model maintains its own independent vector database index.
            </p>

            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-500/20 rounded-xl text-xs space-y-1">
              <div className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>{pendingCount} task(s) waiting in queue</span>
              </div>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                Switching models now means queued tasks will index into the newly selected model&apos;s collection.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {mode === 'active_task' ? (
          <div className="flex gap-2">
            <button
              onClick={onConfirmCancelAndSwitch}
              className="flex-1 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
            >
              Cancel Task & Switch
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-colors"
            >
              Keep Current Model
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={onConfirmProceedWithQueued}
              className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Proceed & Switch Model</span>
            </button>

            <div className="flex gap-2">
              <button
                onClick={onConfirmClearQueueAndSwitch}
                className="flex-1 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Queue & Switch</span>
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
