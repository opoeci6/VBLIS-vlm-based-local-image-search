import i18n from '../i18n';

// The backend names tasks in English (_generate_default_title in api/task_queue.py), and the title is
// stored with the task. This turns those known titles into the interface language by matching the text.
// It does not derive anything from the payload: payloads name roots differently ("E:\" or a share), can
// lack keys, and cannot express a custom title. Anything that does not match is shown as it is.
// If a title changes in api/task_queue.py, change the pattern here too (taskTitle.test.js pins both).
const clearCacheTitles = {
  all: () => i18n.t('queue:taskTitle.clearCache.all'),
  images: () => i18n.t('queue:taskTitle.clearCache.images'),
  videos: () => i18n.t('queue:taskTitle.clearCache.videos'),
};

const RULES = [
  { type: 'INDEX_FOLDERS', pattern: /^Index: (.+)$/, translate: ([, name]) => i18n.t('queue:taskTitle.indexName', { name }) },
  { type: 'INDEX_FOLDERS', pattern: /^Index (\d+) Folders$/, translate: ([, n]) => i18n.t('queue:taskTitle.indexCount', { n }) },
  { type: 'REINDEX_FOLDER', pattern: /^Reindex: (.+)$/, translate: ([, name]) => i18n.t('queue:taskTitle.reindexName', { name }) },
  { type: 'BATCH_REINDEX', pattern: /^Reindex (\d+) Folders$/, translate: ([, n]) => i18n.t('queue:taskTitle.reindexCount', { n }) },
  { type: 'REBUILD_VIDEO_THUMBNAILS', pattern: /^Rebuild Video Thumbnails$/, translate: () => i18n.t('queue:taskTitle.rebuildVideoThumbnails') },
  { type: 'PRUNE_DELETED', pattern: /^Prune Missing Files$/, translate: () => i18n.t('queue:taskTitle.pruneMissing') },
  { type: 'CLEAR_CACHE', pattern: /^Clear (All|Images|Videos) Cache$/, translate: ([, target]) => clearCacheTitles[target.toLowerCase()]() },
  { type: 'SCAN_MEDIA_INFO', pattern: /^Read media details$/, translate: () => i18n.t('queue:taskTitle.scanMediaInfo') },
];

// The title of a task in the interface language, or task.title unchanged when it is not a known one.
export const taskTitle = (task) => {
  const title = task?.title;
  if (typeof title !== 'string' || typeof task.type !== 'string') return title;
  for (const rule of RULES) {
    if (rule.type !== task.type) continue;
    const match = rule.pattern.exec(title);
    if (match) return rule.translate(match);
  }
  return title;
};

// A task type for display. English shows the raw value; an unknown type is shown raw in any language.
export const taskTypeLabel = (type) => {
  // Only plain TYPE_NAMES are looked up: other text could hit a separator or an object property name.
  if (typeof type !== 'string' || !/^[A-Z][A-Z_]*$/.test(type)) return type;
  const key = `queue:taskType.${type}`;
  return i18n.exists(key) ? i18n.t(key) : type;
};
