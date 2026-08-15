import React from 'react';
import { Pause, CheckCircle2, X } from 'lucide-react';

export const StopQueueModal = ({ isOpen, onClose, onSelectOption, uiTheme = 'modern' }) => {
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
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
              <Pause className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold">Stop Background Queue</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-4">
          An indexing or rebuild task is currently running. How would you like to pause the queue?
        </p>

        {/* Options */}
        <div className="space-y-2.5 mb-4">
          <button
            onClick={() => onSelectOption('pause_immediate')}
            className={`w-full p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all ${
              isModern
                ? 'bg-gray-50 dark:bg-neutral-800/60 hover:bg-amber-50/60 dark:hover:bg-amber-950/30 border-gray-200 dark:border-neutral-700 hover:border-amber-300 dark:hover:border-amber-500/40'
                : 'border border-white hover:bg-neutral-900'
            }`}
          >
            <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0">
              <Pause className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-neutral-900 dark:text-white">
                Stop Immediately
              </h4>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                Pauses the active task in place and holds all queued tasks. Can be resumed anytime.
              </p>
            </div>
          </button>

          <button
            onClick={() => onSelectOption('pause_after_current')}
            className={`w-full p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all ${
              isModern
                ? 'bg-gray-50 dark:bg-neutral-800/60 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 border-gray-200 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-500/40'
                : 'border border-white hover:bg-neutral-900'
            }`}
          >
            <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-neutral-900 dark:text-white">
                Finish Current Task then Stop
              </h4>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                Lets the currently active job complete normally, but prevents starting the next task in queue.
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
