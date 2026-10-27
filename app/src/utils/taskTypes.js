// Task types that need an AI model loaded in memory. Mirrors
// MODEL_DEPENDENT_TASK_TYPES in api/task_queue.py; every other type (thumbnail
// rebuilds, media info scans, ...) runs fine with no model.
export const MODEL_DEPENDENT_TASK_TYPES = new Set(['INDEX_FOLDERS', 'REINDEX_FOLDER', 'BATCH_REINDEX']);

export const isModelDependentTask = (task) => Boolean(task) && MODEL_DEPENDENT_TASK_TYPES.has(task.type);

// True when the active task or any pending task needs a model.
export const hasModelDependentTask = (activeTask, pendingTasks) =>
  isModelDependentTask(activeTask) || (Array.isArray(pendingTasks) && pendingTasks.some(isModelDependentTask));
