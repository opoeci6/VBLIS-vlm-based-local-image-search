import { Play, Pause, Square, Layers, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getTaskTypeIcon } from './taskIcon';
import { formatDuration } from '../../utils/formatters';
import { taskTitle, taskTypeLabel } from '../../utils/taskTitle';

export const ActiveTaskCard = ({ task, onPause, onResume, onCancel, uiTheme = 'modern' }) => {
  const { t } = useTranslation('queue');
  if (!task) {
    return (
      <div
        className={`p-6 rounded-2xl text-center border ${
          uiTheme === 'modern'
            ? 'bg-gray-50/50 dark:bg-neutral-800/30 border-dashed border-gray-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500'
            : 'border-dashed border-current opacity-60'
        }`}
      >
        <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs font-semibold">{t('activeTask.emptyTitle')}</p>
        <p className="text-[11px] opacity-70 mt-0.5">{t('activeTask.emptyHint')}</p>
      </div>
    );
  }

  const isModern = uiTheme === 'modern';
  const isPaused = task.status === 'paused' || task.is_paused;

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-200 ${
        isModern
          ? isPaused
            ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30 shadow-sm'
            : 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30 shadow-sm'
          : 'border border-current'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-2 rounded-xl border ${
              isModern
                ? 'bg-white dark:bg-neutral-800 border-gray-200/80 dark:border-neutral-700 shadow-xs'
                : 'icon-tile border border-current'
            }`}
          >
            {getTaskTypeIcon(task.type)}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {taskTitle(task)}
            </h4>
            <div className="flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
              <span>{taskTypeLabel(task.type)}</span>
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
          {isPaused ? t('activeTask.paused') : t('activeTask.running')}
        </span>
      </div>

      {/* Progress Track */}
      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-[11px] text-neutral-600 dark:text-neutral-400 font-medium truncate max-w-[200px]" title={task.current_item}>
            {task.current_item ? t('activeTask.current', { item: task.current_item }) : t('activeTask.processing')}
          </span>
          <span className="font-bold text-neutral-900 dark:text-white ml-2">
            {task.progress}%
          </span>
        </div>

        <div className="terminal-progress-track w-full bg-gray-200 dark:bg-neutral-800 rounded-full h-2 overflow-hidden">
          <div
            className={`terminal-progress-fill h-full rounded-full transition-all duration-300 ease-out ${
              isPaused
                ? 'bg-amber-500'
                : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(3, task.progress))}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
          <span>
            {t('activeTask.progress', { count: Number(task.total_count) || 0, processed: task.processed_count, total: task.total_count || '?' })}
          </span>
          {task.error_count > 0 && (
            <span className="text-rose-500 font-semibold flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {t('activeTask.errors', { count: task.error_count })}
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
            <span>{t('common:resume')}</span>
          </button>
        ) : (
          <button
            onClick={() => onPause(task.id)}
            className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-gray-200 dark:border-neutral-700"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>{t('common:pause')}</span>
          </button>
        )}

        <button
          onClick={() => onCancel(task.id)}
          className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-200 dark:border-rose-500/30"
          title={t('activeTask.cancelTitle')}
        >
          <Square className="w-3.5 h-3.5" />
          <span>{t('common:cancel')}</span>
        </button>
      </div>
    </div>
  );
};
