import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { taskTitle, taskTypeLabel } from './taskTitle';

// The exact strings api/task_queue.py (_generate_default_title) produces, with the task type each belongs to.
// If the backend changes a title, this table and taskTitle.js change together.
const BACKEND_TITLES = [
  { type: 'INDEX_FOLDERS', title: 'Index: Holiday 2024', en: 'Index: Holiday 2024', zh: '索引：Holiday 2024' },
  { type: 'INDEX_FOLDERS', title: 'Index: E:\\', en: 'Index: E:\\', zh: '索引：E:\\' },
  { type: 'INDEX_FOLDERS', title: 'Index: \\\\srv\\share\\', en: 'Index: \\\\srv\\share\\', zh: '索引：\\\\srv\\share\\' },
  { type: 'INDEX_FOLDERS', title: 'Index 3 Folders', en: 'Index 3 Folders', zh: '索引 3 个文件夹' },
  { type: 'REINDEX_FOLDER', title: 'Reindex: Photos', en: 'Reindex: Photos', zh: '重新索引：Photos' },
  { type: 'BATCH_REINDEX', title: 'Reindex 12 Folders', en: 'Reindex 12 Folders', zh: '重新索引 12 个文件夹' },
  { type: 'REBUILD_VIDEO_THUMBNAILS', title: 'Rebuild Video Thumbnails', en: 'Rebuild Video Thumbnails', zh: '重建视频缩略图' },
  { type: 'PRUNE_DELETED', title: 'Prune Missing Files', en: 'Prune Missing Files', zh: '清理缺失的文件' },
  { type: 'CLEAR_CACHE', title: 'Clear All Cache', en: 'Clear All Cache', zh: '清除全部缓存' },
  { type: 'CLEAR_CACHE', title: 'Clear Images Cache', en: 'Clear Images Cache', zh: '清除图片缓存' },
  { type: 'CLEAR_CACHE', title: 'Clear Videos Cache', en: 'Clear Videos Cache', zh: '清除视频缓存' },
  { type: 'SCAN_MEDIA_INFO', title: 'Read media details', en: 'Read media details', zh: '读取媒体详情' },
];

describe('taskTitle', () => {
  it.each(BACKEND_TITLES)('shows "$title" ($type) unchanged in English', ({ type, title, en }) => {
    expect(taskTitle({ type, title })).toBe(en);
    expect(taskTitle({ type, title })).toBe(title);
  });

  it.each(BACKEND_TITLES)('translates "$title" ($type) into Chinese', async ({ type, title, zh }) => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle({ type, title })).toBe(zh);
  });

  it('leaves a custom title untouched in both languages', async () => {
    const task = { type: 'INDEX_FOLDERS', title: 'My nightly photo run' };
    expect(taskTitle(task)).toBe('My nightly photo run');
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle(task)).toBe('My nightly photo run');
  });

  it('leaves a title alone when it belongs to another task type', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle({ type: 'REINDEX_FOLDER', title: 'Index: Photos' })).toBe('Index: Photos');
    expect(taskTitle({ type: 'CLEAR_CACHE', title: 'Read media details' })).toBe('Read media details');
  });

  it('leaves an unknown cache target and near misses alone', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle({ type: 'CLEAR_CACHE', title: 'Clear Thumbs Cache' })).toBe('Clear Thumbs Cache');
    expect(taskTitle({ type: 'INDEX_FOLDERS', title: 'Index 3 Folders now' })).toBe('Index 3 Folders now');
    expect(taskTitle({ type: 'INDEX_FOLDERS', title: 'Index: ' })).toBe('Index: ');
    expect(taskTitle({ type: 'SCAN_MEDIA_INFO', title: 'read media details' })).toBe('read media details');
  });

  it('returns the title when there is no type or the type is unknown', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle({ title: 'Index 3 Folders' })).toBe('Index 3 Folders');
    expect(taskTitle({ type: 'SOMETHING_ELSE', title: 'Index 3 Folders' })).toBe('Index 3 Folders');
    expect(taskTitle({ type: null, title: 'Index 3 Folders' })).toBe('Index 3 Folders');
  });

  it('copes with a missing task or title', () => {
    expect(taskTitle(undefined)).toBeUndefined();
    expect(taskTitle(null)).toBeUndefined();
    expect(taskTitle({ type: 'INDEX_FOLDERS' })).toBeUndefined();
    expect(taskTitle({ type: 'INDEX_FOLDERS', title: null })).toBeNull();
    expect(taskTitle({ type: 'INDEX_FOLDERS', title: '' })).toBe('');
  });

  it('keeps a folder name that looks like a nested translation as plain text', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTitle({ type: 'INDEX_FOLDERS', title: 'Index: $t(common.cancel)' })).toBe('索引：$t(common.cancel)');
  });
});

describe('taskTypeLabel', () => {
  it('shows the raw type in English', () => {
    expect(taskTypeLabel('SCAN_MEDIA_INFO')).toBe('SCAN_MEDIA_INFO');
    expect(taskTypeLabel('INDEX_FOLDERS')).toBe('INDEX_FOLDERS');
  });

  it('translates a known type in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(taskTypeLabel('SCAN_MEDIA_INFO')).toBe('读取媒体详情');
    expect(taskTypeLabel('CLEAR_CACHE')).toBe('清除缓存');
  });

  it('shows an unknown type raw in both languages, without a missing-key error', async () => {
    expect(taskTypeLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
    await i18n.changeLanguage('zh-CN');
    expect(taskTypeLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });

  it('shows odd values raw', () => {
    expect(taskTypeLabel('constructor')).toBe('constructor');
    expect(taskTypeLabel('a.b')).toBe('a.b');
    expect(taskTypeLabel(undefined)).toBeUndefined();
  });
});
