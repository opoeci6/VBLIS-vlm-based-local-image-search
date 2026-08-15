import React, { useState } from 'react';
import { X, Layers, Play, Pause, Clock, History, Loader2, RefreshCw } from 'lucide-react';
import { ActiveTaskCard } from './ActiveTaskCard';
import { QueuedTaskList } from './QueuedTaskList';
import { TaskHistoryList } from './TaskHistoryList';
import { StopQueueModal } from './StopQueueModal';

export const QueueDrawer = ({ isOpen, onClose, queue, uiTheme = 'modern' }) => {
  const [activeTab, setActiveTab] = useState('all');
  const isModern = uiTheme === 'modern';

  if (!isOpen) return null;

  const {
    activeTask,
    pendingTasks,
    history,
    workerState,
    pendingCount,
    historyCount,
    showStopModal,
    setShowStopModal,
    cancelTask,
    pauseTask,
    resumeTask,
    controlWorker,
    moveTask,
    reorderTasks,
    retryTask,
    clearHistory
  } = queue;

  const isPaused = workerState === 'paused';
  const isStoppingAfterCurrent = workerState === 'stopping_after_current';

  const handleMasterToggle = () => {
    if (isPaused) {
      controlWorker('start');
    } else {
      if (activeTask && activeTask.status === 'running') {
        setShowStopModal(true);
      } else {
        controlWorker('pause_immediate');
      }
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        {/* Modal Dialog Card */}
        <div
          className={`w-[780px] max-w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden rounded-3xl border animate-in zoom-in-95 duration-200 ${
            isModern
              ? 'bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-neutral-900 dark:text-white'
              : 'bg-black border-2 border-white text-white'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 dark:border-neutral-800 flex items-start justify-between bg-gray-50/50 dark:bg-neutral-900/50">
            <div className="min-w-0 pr-4">
              <div className="flex items-center gap-3">
                <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Task Queue Manager</h2>
                  <p className="text-xs text-neutral-500 font-mono truncate mt-1">
                    {isPaused
                      ? 'Queue Paused'
                      : isStoppingAfterCurrent
                      ? 'Stopping after current task...'
                      : 'Worker Active'} · {pendingCount} queued · {historyCount} completed
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Master Start / Pause Toggle */}
              <button
                onClick={handleMasterToggle}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border shadow-2xs ${
                  isPaused
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
                    : isStoppingAfterCurrent
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300'
                    : 'bg-white dark:bg-neutral-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-neutral-700 dark:text-neutral-300 border-gray-200 dark:border-neutral-700'
                }`}
                title={isPaused ? 'Resume queue worker' : 'Pause queue worker'}
              >
                {isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Queue</span>
                  </>
                ) : isStoppingAfterCurrent ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                    <span>Stopping...</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause Queue</span>
                  </>
                )}
              </button>

              <button
                onClick={onClose}
                className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Subheader / Tab Pills */}
          <div className="px-6 py-3 border-b border-gray-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2 bg-gray-50/40 dark:bg-neutral-800/20">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'all'
                    ? isModern
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-black'
                    : 'bg-white dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 border border-gray-200/60 dark:border-neutral-700/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Overview</span>
              </button>

              <button
                onClick={() => setActiveTab('queued')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'queued'
                    ? isModern
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-black'
                    : 'bg-white dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 border border-gray-200/60 dark:border-neutral-700/60'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Queued ({pendingCount})</span>
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'history'
                    ? isModern
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-black'
                    : 'bg-white dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 border border-gray-200/60 dark:border-neutral-700/60'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>History ({historyCount})</span>
              </button>
            </div>

            <span className="text-xs text-neutral-500 font-mono hidden sm:inline">
              {activeTask
                ? `${activeTask.title} (${activeTask.progress}%)`
                : `${pendingCount} tasks pending`}
            </span>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {activeTab === 'all' && (
              <>
                {/* Active Task Card Section */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
                      Currently Active Task
                    </span>
                  </div>
                  <ActiveTaskCard
                    task={activeTask}
                    onPause={pauseTask}
                    onResume={resumeTask}
                    onCancel={cancelTask}
                    uiTheme={uiTheme}
                  />
                </div>

                {/* Next in Queue Section */}
                <div className="space-y-2.5 pt-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
                      Next in Queue ({pendingCount})
                    </span>
                    {pendingCount > 4 && (
                      <button
                        onClick={() => setActiveTab('queued')}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        View all {pendingCount} tasks →
                      </button>
                    )}
                  </div>
                  <QueuedTaskList
                    tasks={pendingTasks.slice(0, 4)}
                    allTasks={pendingTasks}
                    onMove={moveTask}
                    onReorder={reorderTasks}
                    onCancel={cancelTask}
                    uiTheme={uiTheme}
                  />
                </div>

                {/* Recent History Section */}
                {history.length > 0 && (
                  <div className="space-y-2.5 pt-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
                        Recent Task History
                      </span>
                      {historyCount > 3 && (
                        <button
                          onClick={() => setActiveTab('history')}
                          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          View all {historyCount} entries →
                        </button>
                      )}
                    </div>
                    <TaskHistoryList
                      history={history.slice(0, 3)}
                      onRetry={retryTask}
                      onClearHistory={clearHistory}
                      uiTheme={uiTheme}
                    />
                  </div>
                )}
              </>
            )}

            {activeTab === 'queued' && (
              <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
                    All Queued Tasks ({pendingCount})
                  </span>
                </div>
                <QueuedTaskList
                  tasks={pendingTasks}
                  allTasks={pendingTasks}
                  onMove={moveTask}
                  onReorder={reorderTasks}
                  onCancel={cancelTask}
                  uiTheme={uiTheme}
                />
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-3">
                <TaskHistoryList
                  history={history}
                  onRetry={retryTask}
                  onClearHistory={clearHistory}
                  uiTheme={uiTheme}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stop Queue Confirmation Modal */}
      <StopQueueModal
        isOpen={showStopModal}
        onClose={() => setShowStopModal(false)}
        onSelectOption={(action) => controlWorker(action)}
        uiTheme={uiTheme}
      />
    </>
  );
};

export const QueueModal = QueueDrawer;
