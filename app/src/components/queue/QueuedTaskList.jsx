import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUp, Trash2, Folder, Video, Clock, RefreshCw, GripVertical } from 'lucide-react';

export const QueuedTaskList = ({
  tasks,
  allTasks,
  onMove,
  onReorder,
  onCancel,
  uiTheme = 'modern'
}) => {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dropPosition, setDropPosition] = useState('before'); // 'before' | 'after'

  const isModern = uiTheme === 'modern';
  const fullTaskList = allTasks || tasks;

  if (!tasks || tasks.length === 0) {
    return (
      <div
        className={`p-8 rounded-2xl text-center border ${
          isModern
            ? 'bg-gray-50/50 dark:bg-neutral-800/30 border-dashed border-gray-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500'
            : 'border-dashed border-current opacity-60'
        }`}
      >
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs font-semibold">Queue is empty</p>
        <p className="text-[11px] opacity-70 mt-0.5">Drop folders or click Add Folders to queue new tasks.</p>
      </div>
    );
  }

  const getTypeIcon = (type) => {
    switch (type) {
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

  const handleDragStart = (e, task) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    setDraggedId(task.id);
  };

  const handleDragOver = (e, task) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedId === task.id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? 'before' : 'after';

    if (dragOverId !== task.id || dropPosition !== pos) {
      setDragOverId(task.id);
      setDropPosition(pos);
    }
  };

  const handleDragLeave = (e, task) => {
    // Only reset if leaving the element itself, not entering a child
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dragOverId === task.id) {
      setDragOverId(null);
    }
  };

  const handleDrop = (e, targetTask) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetTask.id) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const currentList = [...fullTaskList];
    const fromIdx = currentList.findIndex((t) => t.id === draggedId);
    let toIdx = currentList.findIndex((t) => t.id === targetTask.id);

    if (fromIdx === -1 || toIdx === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const [movedItem] = currentList.splice(fromIdx, 1);
    // Recalculate target index after removal
    toIdx = currentList.findIndex((t) => t.id === targetTask.id);

    if (dropPosition === 'after') {
      currentList.splice(toIdx + 1, 0, movedItem);
    } else {
      currentList.splice(toIdx, 0, movedItem);
    }

    if (onReorder) {
      onReorder(currentList);
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="space-y-2.5">
      {tasks.map((task, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === tasks.length - 1;
        const isDragging = draggedId === task.id;
        const isOver = dragOverId === task.id;

        return (
          <div key={task.id} className="relative transition-all duration-150">
            {/* Drop indicator line (before) */}
            {isOver && dropPosition === 'before' && (
              <div className="absolute -top-1.5 inset-x-2 h-0.5 bg-indigo-500 dark:bg-indigo-400 rounded-full shadow-sm z-10 animate-pulse" />
            )}

            <div
              draggable
              onDragStart={(e) => handleDragStart(e, task)}
              onDragOver={(e) => handleDragOver(e, task)}
              onDragLeave={(e) => handleDragLeave(e, task)}
              onDrop={(e) => handleDrop(e, task)}
              onDragEnd={handleDragEnd}
              className={`group p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-all duration-150 cursor-grab active:cursor-grabbing select-none ${
                isDragging
                  ? 'opacity-40 scale-[0.98] border-dashed border-indigo-400 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-none'
                  : isOver
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                  : isModern
                  ? 'bg-white dark:bg-neutral-800/60 border-gray-100 dark:border-neutral-800 hover:border-indigo-200 dark:hover:border-indigo-500/30 shadow-2xs hover:shadow-xs'
                  : 'border border-current'
              }`}
            >
              {/* Left: Drag Handle, Position & Title */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div
                  className="p-1 -ml-1 text-neutral-300 dark:text-neutral-600 group-hover:text-neutral-500 dark:group-hover:text-neutral-400 transition-colors shrink-0"
                  title="Drag to reorder"
                >
                  <GripVertical className="w-4 h-4" />
                </div>

                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold shrink-0 ${
                    isModern
                      ? 'bg-gray-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                      : 'border border-current'
                  }`}
                >
                  #{idx + 1}
                </span>

                <div className="p-2 rounded-xl bg-gray-50 dark:bg-neutral-700/50 shrink-0">
                  {getTypeIcon(task.type)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                    {task.title}
                  </p>
                  <p className="text-[10px] text-neutral-400 font-mono truncate mt-0.5">
                    {task.type}
                  </p>
                </div>
              </div>

              {/* Right: Reorder Buttons & Cancel Action */}
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {tasks.length > 2 && !isFirst && (
                  <button
                    onClick={() => onMove(task.id, 'top')}
                    className="p-1.5 text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                    title="Move to top of queue"
                  >
                    <ChevronsUp className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={() => onMove(task.id, 'up')}
                  disabled={isFirst}
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                  title="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>

                <button
                  onClick={() => onMove(task.id, 'down')}
                  disabled={isLast}
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                  title="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>

                <button
                  onClick={() => onCancel(task.id)}
                  className="p-1.5 text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors ml-1 cursor-pointer"
                  title="Remove from queue"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drop indicator line (after) */}
            {isOver && dropPosition === 'after' && (
              <div className="absolute -bottom-1.5 inset-x-2 h-0.5 bg-indigo-500 dark:bg-indigo-400 rounded-full shadow-sm z-10 animate-pulse" />
            )}
          </div>
        );
      })}
    </div>
  );
};
