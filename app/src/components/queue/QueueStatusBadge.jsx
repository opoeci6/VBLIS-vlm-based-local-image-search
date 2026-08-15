import React from 'react';
import { Layers, Loader2, Pause, Clock } from 'lucide-react';

export const QueueStatusBadge = ({ queue, uiTheme = 'modern' }) => {
  const { activeTask, pendingCount, workerState, isDrawerOpen, setIsDrawerOpen } = queue;
  const isModern = uiTheme === 'modern';

  const isRunning = activeTask && activeTask.status === 'running' && workerState === 'running';
  const isPaused = workerState === 'paused' || (activeTask && (activeTask.status === 'paused' || activeTask.is_paused));
  const isStoppingAfterCurrent = workerState === 'stopping_after_current';

  let titleText = "Open Background Task Queue";
  if (isPaused) {
    titleText = pendingCount > 0 || activeTask
      ? `Queue is Paused (${pendingCount + (activeTask ? 1 : 0)} task${(pendingCount + (activeTask ? 1 : 0)) > 1 ? 's' : ''} waiting). Click to open and start queue.`
      : "Queue is Paused. Click to open Task Manager.";
  } else if (isRunning) {
    titleText = `Processing: ${activeTask.title} (${activeTask.progress}%). Click to open Task Manager.`;
  } else if (pendingCount > 0) {
    titleText = `${pendingCount} task(s) queued. Click to open Task Manager.`;
  }

  return (
    <button
      onClick={() => setIsDrawerOpen(!isDrawerOpen)}
      className={`relative flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200 text-xs font-medium select-none cursor-pointer ${
        isModern
          ? isRunning
            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 shadow-sm'
            : isPaused
            ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 shadow-xs'
            : pendingCount > 0
            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-100'
            : 'bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border border-gray-200/80 dark:border-neutral-700'
          : 'border border-white bg-black text-white hover:bg-neutral-900'
      }`}
      title={titleText}
    >
      {isRunning ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
      ) : isPaused ? (
        <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
      ) : pendingCount > 0 ? (
        <Clock className="w-3.5 h-3.5 text-blue-500" />
      ) : (
        <Layers className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
      )}

      {activeTask ? (
        <div className="flex items-center gap-1.5 max-w-[170px] truncate">
          <span className="truncate">{activeTask.title}</span>
          <span className="font-mono text-[11px] font-bold opacity-90">
            {activeTask.progress}%
          </span>
        </div>
      ) : isPaused ? (
        <span className="font-semibold text-amber-900 dark:text-amber-200">Queue Paused</span>
      ) : (
        <span>Queue</span>
      )}

      {pendingCount > 0 && (
        <span
          className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
            isModern
              ? isPaused
                ? 'bg-amber-600 dark:bg-amber-500 text-white'
                : 'bg-indigo-600 dark:bg-indigo-500 text-white'
              : 'bg-white text-black'
          }`}
        >
          +{pendingCount}
        </span>
      )}

      {isStoppingAfterCurrent && (
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" title="Stopping after current" />
      )}
    </button>
  );
};
