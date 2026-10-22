import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatTimeAgo,
  formatVideoTimestamp,
} from './formatters';

// Reference copies of the inline helpers in App.jsx (the source of truth until Phase 1
// switches App.jsx over to utils/formatters.js).
const appFormatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const appFormatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds === Infinity) return 'Calculating...';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const appFormatVideoTimestamp = (seconds = 0) => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

describe('formatBytes', () => {
  it('returns "0 B" for zero and missing values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
  });

  it('formats bytes, KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1234567)).toBe('1.18 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  it('keeps two decimals (not one)', () => {
    expect(formatBytes(1234567)).not.toBe('1.2 MB');
    expect(formatBytes(1024 * 1.234)).toBe('1.23 KB');
  });

  it('matches the App.jsx inline implementation', () => {
    const inputs = [
      0, undefined, null, 1, 2, 500, 512, 1023, 1024, 1025, 1536, 10_000, 123_456,
      1_048_575, 1_048_576, 1_234_567, 99_999_999, 1024 ** 3, 1.5 * 1024 ** 3,
      7_654_321_098, 1024 ** 4, 3.3 * 1024 ** 4, -5,
    ];
    for (const n of inputs) {
      expect(formatBytes(n), String(n)).toBe(appFormatBytes(n));
    }
  });
});

describe('formatDuration', () => {
  it('returns "0s" for zero, negative and missing values', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(undefined)).toBe('0s');
  });

  it('returns "Calculating..." for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('Calculating...');
  });

  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(61)).toBe('1m 1s');
    expect(formatDuration(3661)).toBe('1h 1m 1s');
    expect(formatDuration(3600)).toBe('1h 0m 0s');
  });

  it('matches the App.jsx inline implementation', () => {
    const inputs = [
      0, -1, -Infinity, undefined, null, NaN, 0.5, 1, 59, 59.9, 60, 61, 3599, 3600, 3661,
      86_399, 100_000, Infinity,
    ];
    for (const n of inputs) {
      expect(formatDuration(n), String(n)).toBe(appFormatDuration(n));
    }
  });
});

describe('formatVideoTimestamp', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatVideoTimestamp(0)).toBe('0:00');
    expect(formatVideoTimestamp(65.9)).toBe('1:05');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatVideoTimestamp(3725)).toBe('1:02:05');
  });

  it('clamps negatives to zero and defaults to zero', () => {
    expect(formatVideoTimestamp(-10)).toBe('0:00');
    expect(formatVideoTimestamp()).toBe('0:00');
  });

  it('matches the App.jsx inline implementation', () => {
    for (const n of [undefined, 0, -3, 0.9, 5, 59.99, 60, 65.9, 3599, 3600, 3725, 90_000]) {
      expect(formatVideoTimestamp(n), String(n)).toBe(appFormatVideoTimestamp(n));
    }
  });
});

describe('formatTimeAgo', () => {
  const NOW_MS = Date.UTC(2025, 0, 15, 12, 0, 0);
  const nowSec = NOW_MS / 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  function atNow() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  }

  it('returns an empty string for falsy input', () => {
    atNow();
    expect(formatTimeAgo(0)).toBe('');
    expect(formatTimeAgo(null)).toBe('');
    expect(formatTimeAgo(undefined)).toBe('');
  });

  it('returns "Just now" under a minute (and for future timestamps)', () => {
    atNow();
    expect(formatTimeAgo(nowSec)).toBe('Just now');
    expect(formatTimeAgo(nowSec - 59)).toBe('Just now');
    expect(formatTimeAgo(nowSec + 100)).toBe('Just now');
  });

  it('returns minutes', () => {
    atNow();
    expect(formatTimeAgo(nowSec - 60)).toBe('1m ago');
    expect(formatTimeAgo(nowSec - 59 * 60)).toBe('59m ago');
  });

  it('returns hours', () => {
    atNow();
    expect(formatTimeAgo(nowSec - 3600)).toBe('1h ago');
    expect(formatTimeAgo(nowSec - 23 * 3600)).toBe('23h ago');
  });

  it('returns days', () => {
    atNow();
    expect(formatTimeAgo(nowSec - 86400)).toBe('1d ago');
    expect(formatTimeAgo(nowSec - 3 * 86400 - 5)).toBe('3d ago');
  });
});
