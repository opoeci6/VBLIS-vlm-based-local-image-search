import i18n from '../i18n';

// Numbers grouped the way the interface language does it.
export const formatNumber = (n) => new Intl.NumberFormat(i18n.language).format(n);

export const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return i18n.t('format:duration.zero');
  if (seconds === Infinity) return i18n.t('format:duration.calculating');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return i18n.t('format:duration.hms', { h, m, s });
  if (m > 0) return i18n.t('format:duration.ms', { m, s });
  return i18n.t('format:duration.s', { s });
};

export const formatVideoTimestamp = (seconds = 0) => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

export const formatTimeAgo = (timestamp) => {
  if (!timestamp) return '';
  const now = Date.now() / 1000;
  const diff = Math.max(0, Math.floor(now - timestamp));
  if (diff < 60) return i18n.t('format:timeAgo.justNow');
  if (diff < 3600) return i18n.t('format:timeAgo.minutes', { n: Math.floor(diff / 60) });
  if (diff < 86400) return i18n.t('format:timeAgo.hours', { n: Math.floor(diff / 3600) });
  return i18n.t('format:timeAgo.days', { n: Math.floor(diff / 86400) });
};

// Short local date ("Mar 12, 2024" in English, "2024年3月12日" in Chinese) from a "YYYY-MM-DDTHH:MM:SS"
// wall time, in the interface language rather than the Windows regional format. The date is built from its
// own parts, so a time zone can never shift it to the day before or after. '' for null or an invalid value.
export const formatTakenDate = (takenAt) => {
  if (typeof takenAt !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(takenAt);
  if (!match) return '';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' });
};
