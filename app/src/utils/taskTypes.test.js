import { describe, expect, it } from 'vitest';
import { MODEL_DEPENDENT_TASK_TYPES, hasModelDependentTask, isModelDependentTask } from './taskTypes';

describe('isModelDependentTask', () => {
  it.each(['INDEX_FOLDERS', 'REINDEX_FOLDER', 'BATCH_REINDEX'])('is true for %s', (type) => {
    expect(isModelDependentTask({ type })).toBe(true);
  });

  it.each(['SCAN_MEDIA_INFO', 'REBUILD_VIDEO_THUMBNAILS', 'SOMETHING_NEW', undefined])('is false for %s', (type) => {
    expect(isModelDependentTask({ type })).toBe(false);
  });

  it('is false for a missing task', () => {
    expect(isModelDependentTask(null)).toBe(false);
    expect(isModelDependentTask(undefined)).toBe(false);
  });

  it('exposes exactly the three model-dependent types', () => {
    expect([...MODEL_DEPENDENT_TASK_TYPES].sort()).toEqual(['BATCH_REINDEX', 'INDEX_FOLDERS', 'REINDEX_FOLDER']);
  });
});

describe('hasModelDependentTask', () => {
  const scan = { type: 'SCAN_MEDIA_INFO' };
  const index = { type: 'INDEX_FOLDERS' };

  it('is false with nothing queued', () => {
    expect(hasModelDependentTask(null, [])).toBe(false);
    expect(hasModelDependentTask(null, undefined)).toBe(false);
  });

  it('is false when only non-model tasks are active or pending', () => {
    expect(hasModelDependentTask(scan, [scan])).toBe(false);
  });

  it('is true when the active task needs a model', () => {
    expect(hasModelDependentTask(index, [])).toBe(true);
  });

  it('is true when any pending task needs a model', () => {
    expect(hasModelDependentTask(scan, [scan, index])).toBe(true);
  });
});
