import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, XCircle, RotateCcw, Trash2, ChevronDown, ChevronRight, History } from 'lucide-react';
import { formatDuration, formatTimeAgo } from '../../utils/formatters';

export const TaskHistoryList = ({ history, onRetry, onClearHistory, uiTheme = 'modern' }) => {
  const [expandedErrorId, setExpandedErrorId] = useState(null);
  const isModern = uiTheme === 'modern';

  if (!history || history.length === 0) {
    return (
      <div
        className={`p-8 rounded-2xl text-center border ${
          isModern
            ? 'bg-gray-50/50 dark:bg-neutral-800/30 border-dashed border-gray-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500'
            : 'border-dashed border-white text-white/50'
        }`}
      >
        <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs font-semibold">No task history</p>
        <p className="text-[11px] opacity-70 mt-0.5">Completed and cancelled tasks will appear here.</p>
      </div>
    );
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> COMPLETED
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-500/20">
            <AlertCircle className="w-3 h-3" /> FAILED
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20">
            <XCircle className="w-3 h-3" /> CANCELLED
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3">
      {/* Top action bar */}
      <div className="flex justify-between items-center px-1">
        <span className="text-[11px] font-mono text-neutral-400">
          Last {history.length} task(s)
        </span>
        <button
          onClick={onClearHistory}
          className="text-[11px] text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear History</span>
        </button>
      </div>

      {/* History Items */}
      <div className="space-y-2.5">
        {history.map((task) => {
          const hasErrors = task.errors && task.errors.length > 0;
          const isErrorExpanded = expandedErrorId === task.id;

          return (
            <div
              key={task.id}
              className={`p-3.5 rounded-2xl border transition-all duration-150 ${
                isModern
                  ? 'bg-white dark:bg-neutral-800/60 border-gray-100 dark:border-neutral-800 hover:border-gray-200 dark:hover:border-neutral-700 shadow-2xs'
                  : 'border border-white bg-black text-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusBadge(task.status)}
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {formatTimeAgo(task.completed_at || task.created_at)}
                    </span>
                  </div>

                  <h5 className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                    {task.title}
                  </h5>

                  <div className="flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
                    <span>{task.processed_count} of {task.total_count || 0} items</span>
                    {task.duration > 0 && <span>· {formatDuration(task.duration)}</span>}
                  </div>
                </div>

                <button
                  onClick={() => onRetry(task.id)}
                  className="px-2.5 py-1 bg-gray-50 dark:bg-neutral-700/50 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-gray-200/80 dark:border-neutral-600/50 shrink-0 cursor-pointer shadow-2xs"
                  title="Re-queue this task"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>

              {/* Error logs dropdown */}
              {hasErrors && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-neutral-700/50">
                  <button
                    onClick={() => setExpandedErrorId(isErrorExpanded ? null : task.id)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    {isErrorExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>{task.errors.length} error message(s)</span>
                  </button>

                  {isErrorExpanded && (
                    <div className="mt-2 p-2.5 bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-500/20 rounded-xl text-[10px] font-mono text-rose-700 dark:text-rose-300 max-h-28 overflow-y-auto space-y-1 custom-scrollbar">
                      {task.errors.map((err, i) => (
                        <div key={i} className="truncate" title={err}>
                          • {err}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
