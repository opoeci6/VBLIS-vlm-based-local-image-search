import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatTakenDate,
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

describe('formatTakenDate', () => {
  // The interface language decides the format, not the Windows regional settings. Tests run in English.
  const expected = (year, monthIndex, day) => new Date(year, monthIndex, day)
    .toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });

  it('formats the date part as a short local date', () => {
    const text = formatTakenDate('2024-03-12T15:45:10');
    expect(text).toBe(expected(2024, 2, 12));
    expect(text).toContain('2024');
  });

  it('does not shift a time at midnight or just before it to another day', () => {
    expect(formatTakenDate('2024-03-12T00:00:00')).toBe(expected(2024, 2, 12));
    expect(formatTakenDate('2024-03-12T23:59:59')).toBe(expected(2024, 2, 12));
    expect(formatTakenDate('2023-12-31T23:59:59')).toBe(expected(2023, 11, 31));
    expect(formatTakenDate('2024-01-01T00:00:00')).toBe(expected(2024, 0, 1));
  });

  it('accepts a bare date', () => {
    expect(formatTakenDate('2024-03-12')).toBe(expected(2024, 2, 12));
  });

  it('writes English dates the US way', () => {
    expect(formatTakenDate('2024-03-12T15:45:10')).toBe('Mar 12, 2024');
  });

  it('follows the interface language', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(formatTakenDate('2024-03-12T15:45:10')).toBe(
      new Date(2024, 2, 12).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }),
    );
    expect(formatTakenDate('2024-03-12T15:45:10')).not.toBe('Mar 12, 2024');
    expect(formatTakenDate('2024-03-12T15:45:10')).toContain('2024');
  });

  it('returns an empty string for null, undefined and non-strings', () => {
    expect(formatTakenDate(null)).toBe('');
    expect(formatTakenDate(undefined)).toBe('');
    expect(formatTakenDate(1710000000)).toBe('');
  });

  it('returns an empty string for text that is not a date', () => {
    expect(formatTakenDate('')).toBe('');
    expect(formatTakenDate('yesterday')).toBe('');
    expect(formatTakenDate('2024-13-01T00:00:00')).toBe('');
    expect(formatTakenDate('2024-02-30T00:00:00')).toBe('');
    expect(formatTakenDate('2024-3-12')).toBe('');
  });
});

describe('formatNumber', () => {
  it('groups digits in English', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
  });

  it('follows the interface language', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(formatNumber(1234567)).toBe(new Intl.NumberFormat('zh-CN').format(1234567));
  });
});

describe('formatters in Chinese', () => {
  it('translates durations', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(formatDuration(0)).toBe('0 秒');
    expect(formatDuration(Infinity)).toBe('正在计算……');
    expect(formatDuration(45)).toBe('45 秒');
    expect(formatDuration(125)).toBe('2 分 5 秒');
    expect(formatDuration(3725)).toBe('1 小时 2 分 5 秒');
  });

  it('translates relative times', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-03-12T12:00:00Z'));
      const now = Date.now() / 1000;
      await i18n.changeLanguage('zh-CN');
      expect(formatTimeAgo(now - 5)).toBe('刚刚');
      expect(formatTimeAgo(now - 5 * 60)).toBe('5 分钟前');
      expect(formatTimeAgo(now - 3 * 3600)).toBe('3 小时前');
      expect(formatTimeAgo(now - 2 * 86400)).toBe('2 天前');
    } finally {
      vi.useRealTimers();
    }
  });
});
