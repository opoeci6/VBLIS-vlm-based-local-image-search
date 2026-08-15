import React from 'react';
import { Play, Pause, Square, Folder, Video, RefreshCw, Layers, AlertCircle, FileText } from 'lucide-react';
import { formatDuration } from '../../utils/formatters';

export const ActiveTaskCard = ({ task, onPause, onResume, onCancel, uiTheme = 'modern' }) => {
  if (!task) {
    return (
      <div
        className={`p-6 rounded-2xl text-center border ${
          uiTheme === 'modern'
            ? 'bg-gray-50/50 dark:bg-neutral-800/30 border-dashed border-gray-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500'
            : 'border-dashed border-white text-white/50'
        }`}
      >
        <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs font-semibold">No active task in progress</p>
        <p className="text-[11px] opacity-70 mt-0.5">Drag folders or trigger maintenance to queue new work.</p>
      </div>
    );
  }

  const isModern = uiTheme === 'modern';
  const isPaused = task.status === 'paused' || task.is_paused;

  const getTypeIcon = () => {
    switch (task.type) {
      case 'INDEX_FOLDERS':
      case 'REINDEX_FOLDER':
      case 'BATCH_REINDEX':
        return <Folder className="w-4 h-4 text-indigo-500" />;
      case 'REBUILD_VIDEO_THUMBNAILS':
        return <Video className="w-4 h-4 text-cyan-500" />;
      default:
        return <RefreshCw className="w-4 h-4 text-emerald-500" />;
    }
  };

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-200 ${
        isModern
          ? isPaused
            ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30 shadow-sm'
            : 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30 shadow-sm'
          : 'border border-white bg-neutral-900 text-white'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-2 rounded-xl border ${
              isModern
                ? 'bg-white dark:bg-neutral-800 border-gray-200/80 dark:border-neutral-700 shadow-xs'
                : 'border border-white bg-black'
            }`}
          >
            {getTypeIcon()}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {task.title}
            </h4>
            <div className="flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
              <span>{task.type}</span>
              {task.duration > 0 && <span>· {formatDuration(task.duration)}</span>}
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
            isPaused
              ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
              : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30 animate-pulse'
          }`}
        >
          {isPaused ? 'PAUSED' : 'RUNNING'}
        </span>
      </div>

      {/* Progress Track */}
      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-[11px] text-neutral-600 dark:text-neutral-400 font-medium truncate max-w-[200px]" title={task.current_item}>
            {task.current_item ? `Current: ${task.current_item}` : 'Processing...'}
          </span>
          <span className="font-bold text-neutral-900 dark:text-white ml-2">
            {task.progress}%
          </span>
        </div>

        <div className="w-full bg-gray-200 dark:bg-neutral-800 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${
              isPaused
                ? 'bg-amber-500'
                : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(3, task.progress))}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
          <span>
            {task.processed_count} of {task.total_count || '?'} items
          </span>
          {task.error_count > 0 && (
            <span className="text-rose-500 font-semibold flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {task.error_count} error(s)
            </span>
          )}
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-200/60 dark:border-neutral-800">
        {isPaused ? (
          <button
            onClick={() => onResume(task.id)}
            className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Resume</span>
          </button>
        ) : (
          <button
            onClick={() => onPause(task.id)}
            className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-gray-200 dark:border-neutral-700"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause</span>
          </button>
        )}

        <button
          onClick={() => onCancel(task.id)}
          className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-200 dark:border-rose-500/30"
          title="Cancel task"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
};
