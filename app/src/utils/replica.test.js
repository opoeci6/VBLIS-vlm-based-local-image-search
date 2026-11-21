import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INDEXING_TASK_TYPES,
  isReadOnlyRefusal,
  readOnlyMessage,
  readRefusalBody,
  refusalText,
  rememberReplicaHost,
} from './replica';
import { requestJson } from './serverRequest';
import { formatDate } from './formatters';
import { buildNetworkSession, DESKTOP_SESSION } from '../session/sessionContext';

describe('replica helpers', () => {
  afterEach(() => rememberReplicaHost(null));

  it('names the host in the read-only message, or another computer', () => {
    expect(readOnlyMessage()).toBe('This library is a read-only copy; indexing happens on another computer.');
    rememberReplicaHost('PC-1');
    expect(readOnlyMessage()).toBe('This library is a read-only copy; indexing happens on PC-1.');
    rememberReplicaHost('');
    expect(readOnlyMessage()).toContain('another computer');
  });

  it('recognises the read_only code only', () => {
    expect(isReadOnlyRefusal({ code: 'read_only', detail: 'x' })).toBe(true);
    expect(isReadOnlyRefusal({ code: 'other' })).toBe(false);
    expect(isReadOnlyRefusal(null)).toBe(false);
    expect(refusalText({ code: 'read_only' }, 'fallback')).toBe(readOnlyMessage());
    expect(refusalText({ detail: 'busy' }, 'fallback')).toBe('fallback');
  });

  it('reads the body of a refusal, and null when there is none', async () => {
    expect(await readRefusalBody({ json: async () => ({ a: 1 }) })).toEqual({ a: 1 });
    expect(await readRefusalBody({ json: async () => { throw new Error('no body'); } })).toBeNull();
    expect(await readRefusalBody({})).toBeNull();
  });

  it('lists the task types a copy refuses to queue', () => {
    expect([...INDEXING_TASK_TYPES].sort()).toEqual(['BATCH_REINDEX', 'INDEX_FOLDERS', 'REINDEX_FOLDER', 'SCAN_MEDIA_INFO']);
  });

  it('formats an ISO timestamp as a short date, and gives nothing for a bad one', () => {
    expect(formatDate('2026-11-20T12:00:00+00:00')).toMatch(/^Nov (19|20|21), 2026$/);
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });
});

describe('requestJson with a read_only refusal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'This library is a read-only copy.', code: 'read_only' }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rememberReplicaHost(null);
  });

  it('answers with the translated sentence and keeps the code', async () => {
    rememberReplicaHost('PC-1');
    const result = await requestJson('POST', '/index/clear');
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'read_only',
      message: 'This library is a read-only copy; indexing happens on PC-1.',
    });
  });
});

describe('what the session says about a read-only copy', () => {
  const info = { signed_in: true, role: 'owner', permissions: {} };

  it('is not read-only by default', () => {
    expect(DESKTOP_SESSION.readOnly).toBe(false);
    expect(DESKTOP_SESSION.replica).toBeNull();
    expect(buildNetworkSession(info, vi.fn(), vi.fn())).toMatchObject({ readOnly: false, replica: null });
  });

  it('carries read_only and the replica of the session', () => {
    const replica = { source_host: 'PC-1', model_id: 'org/model-a', missing: 0 };
    expect(buildNetworkSession({ ...info, read_only: true, replica }, vi.fn(), vi.fn())).toMatchObject({ readOnly: true, replica });
    expect(buildNetworkSession({ ...info, role: 'viewer', read_only: true, replica: null }, vi.fn(), vi.fn()))
      .toMatchObject({ readOnly: true, replica: null });
  });
});
