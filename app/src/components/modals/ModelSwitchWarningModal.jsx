import { AlertTriangle, X, ShieldAlert, Layers, Trash2, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { taskTitle } from '../../utils/taskTitle';

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
  const { t } = useTranslation('settings');
  const backdropDismiss = useBackdropDismiss(onClose);

  if (!isOpen) return null;
  const isModern = uiTheme === 'modern';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150" {...backdropDismiss}>
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
                {mode === 'active_task' ? t('modelSwitch.activeTaskTitle') : t('modelSwitch.queuedTasksTitle')}
              </h3>
              <p className="text-[11px] text-neutral-400 font-mono">
                {t('modelSwitch.target', { model: targetModel })}
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
              {t('modelSwitch.activeTaskBody')}
            </p>

            {activeTask && (
              <div className="p-3 bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-500/20 rounded-xl text-xs space-y-1">
                <div className="font-bold text-rose-800 dark:text-rose-200 truncate">
                  {taskTitle(activeTask)}
                </div>
                <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 font-mono">
                  {t('modelSwitch.taskProgress', { processed: activeTask.processed_count, total: activeTask.total_count || '?', count: Number(activeTask.total_count) || 0, progress: activeTask.progress })}
                </div>
              </div>
            )}

            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {t('modelSwitch.cancelledNote')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-5">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {t('modelSwitch.independentIndex')}
            </p>

            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-500/20 rounded-xl text-xs space-y-1">
              <div className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>{t('modelSwitch.queued', { count: pendingCount })}</span>
              </div>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                {t('modelSwitch.queuedNote')}
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
              {t('modelSwitch.cancelAndSwitch')}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-colors"
            >
              {t('modelSwitch.keepModel')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={onConfirmProceedWithQueued}
              className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t('modelSwitch.proceed')}</span>
            </button>

            <div className="flex gap-2">
              <button
                onClick={onConfirmClearQueueAndSwitch}
                className="flex-1 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('modelSwitch.clearQueue')}</span>
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-colors"
              >
                {t('common:cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
