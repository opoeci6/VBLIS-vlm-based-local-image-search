// Pure helpers for the search filters: folder selection rules, date presets and the request/chip
// builders. Kept free of React so they are easy to test.

export const ORIENTATIONS = ['landscape', 'portrait', 'square'];

export const ORIENTATION_LABELS = {
  landscape: 'Landscape',
  portrait: 'Portrait',
  square: 'Square',
};

// Fallback labels for format ids. The backend's own labels (filter-options) win, so a format it
// adds later shows correctly without a change here.
export const FORMAT_LABELS = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  bmp: 'BMP',
  heic: 'HEIC',
  avif: 'AVIF',
  mp4: 'MP4',
  m4v: 'M4V',
  mov: 'MOV',
  mkv: 'MKV',
  avi: 'AVI',
  webm: 'WebM',
};

export const MEGAPIXEL_CHOICES = [2, 8, 12, 24];

const EN_DASH = '\u2013';
const GTE = '\u2265';

// ---------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------

// Windows paths are case-insensitive and may mix separators, so compare them in one canonical form.
export function normalizeFolderPath(path) {
  return String(path ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

// True when `path` is `ancestor` itself or lies below it ("C:\Photos2" is not inside "C:\Photos").
export function isSameOrInsideFolder(path, ancestor) {
  const p = normalizeFolderPath(path);
  const a = normalizeFolderPath(ancestor);
  if (!a) return false;
  return p === a || p.startsWith(`${a}/`);
}

export function isInsideFolder(path, ancestor) {
  return isSameOrInsideFolder(path, ancestor) && normalizeFolderPath(path) !== normalizeFolderPath(ancestor);
}

export function isFolderSelected(selected, path) {
  const target = normalizeFolderPath(path);
  return selected.some(item => normalizeFolderPath(item) === target);
}

// The selected folder that already covers `path` (a strict ancestor), or null.
export function findSelectedAncestor(selected, path) {
  return selected.find(item => isInsideFolder(path, item)) ?? null;
}

// Toggle one folder in the selection:
//  - selected: it is removed;
//  - an ancestor is selected: nothing changes (the folder is already included);
//  - otherwise it is added and any selected descendants are dropped (the new folder covers them).
// Returns the same array when nothing changes.
export function toggleFolderSelection(selected, path) {
  if (isFolderSelected(selected, path)) {
    const target = normalizeFolderPath(path);
    return selected.filter(item => normalizeFolderPath(item) !== target);
  }
  if (findSelectedAncestor(selected, path)) return selected;
  return [...selected.filter(item => !isInsideFolder(item, path)), path];
}

export function folderBaseName(path) {
  const trimmed = String(path ?? '').replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || String(path ?? '');
}

// ---------------------------------------------------------------------------------------------
// Dates (always local calendar days; toISOString() would shift the day through UTC)
// ---------------------------------------------------------------------------------------------

const pad = (value, width = 2) => String(value).padStart(width, '0');

export function formatLocalDate(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null;
}

const YEAR_PRESET = /^year:(\d{4})$/;

// { from, to } for a preset, or null for an unknown one. `now` is injectable for tests.
export function resolveDatePreset(preset, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (preset === 'last30') {
    return { from: formatLocalDate(new Date(year, month, day - 29)), to: formatLocalDate(now) };
  }
  if (preset === 'last12m') {
    let from = new Date(year - 1, month, day);
    // Feb 29 has no counterpart a year earlier: Date rolls it into March, so use Feb 28 instead.
    if (from.getMonth() !== month) from = new Date(year - 1, month + 1, 0);
    return { from: formatLocalDate(from), to: formatLocalDate(now) };
  }
  const match = YEAR_PRESET.exec(preset ?? '');
  if (match) return { from: `${match[1]}-01-01`, to: `${match[1]}-12-31` };
  return null;
}

// The effective inclusive range of the date filter. A custom range typed backwards is swapped
// instead of being ignored, so the filter always does what the two inputs visibly say.
export function effectiveDateRange({ datePreset, dateFrom, dateTo }) {
  if (!datePreset) return null;
  let from = cleanDate(dateFrom);
  let to = cleanDate(dateTo);
  if (!from && !to) return null;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

function describeDate({ datePreset }, range) {
  if (datePreset === 'last30') return 'Last 30 days';
  if (datePreset === 'last12m') return 'Last 12 months';
  const year = YEAR_PRESET.exec(datePreset ?? '');
  if (year) return year[1];
  if (range.from && range.to) return `${range.from} ${EN_DASH} ${range.to}`;
  if (range.from) return `From ${range.from}`;
  return `Until ${range.to}`;
}

// ---------------------------------------------------------------------------------------------
// Request object and chips
// ---------------------------------------------------------------------------------------------

const inCanonicalOrder = (values, order) => order.filter(item => values.includes(item));

// Format ids come from the backend, so there is no fixed list: a stable alphabetical order keeps
// the request (and the chip text) independent of the order the toggles were clicked in.
const sortedFormats = (values) => [...values].sort();

export function formatLabel(id, labels) {
  return labels?.[id] || FORMAT_LABELS[id] || String(id).toUpperCase();
}

// Files that have no media details yet (and are not just in an unplugged folder).
export function countMissingDetails(options) {
  if (!options || options.registry_available === false) return 0;
  const reported = Number(options.missing_details);
  if (Number.isFinite(reported)) return Math.max(0, reported);
  const derived = (Number(options.total_files) || 0) - (Number(options.with_details) || 0) - (Number(options.unavailable) || 0);
  return Math.max(0, derived);
}

// True when a filter that needs media details (date, orientation, resolution) is active.
export function hasDetailsFilter(filters) {
  return Boolean(filters && (filters.date_from || filters.date_to || filters.orientations || filters.min_megapixels));
}

// The `filters` object of the search API, or null when no filter is active.
export function buildRequestFilters(state) {
  const filters = {};
  if (state.mediaType) filters.media_type = state.mediaType;
  if (state.folders.length > 0) filters.folders = [...state.folders];
  const range = effectiveDateRange(state);
  if (range?.from) filters.date_from = range.from;
  if (range?.to) filters.date_to = range.to;
  if (state.orientations.length > 0) filters.orientations = inCanonicalOrder(state.orientations, ORIENTATIONS);
  if (state.formats.length > 0) filters.formats = sortedFormats(state.formats);
  if (state.minMegapixels) filters.min_megapixels = state.minMegapixels;
  return Object.keys(filters).length > 0 ? filters : null;
}

// Number of active filter kinds (a folder list or a date range counts once).
export function countActiveFilters(state) {
  return [
    Boolean(state.mediaType),
    state.folders.length > 0,
    Boolean(effectiveDateRange(state)),
    state.orientations.length > 0,
    state.formats.length > 0,
    Boolean(state.minMegapixels),
  ].filter(Boolean).length;
}

// Pills for the active filters: [{ key, label, onRemove }]. `actions` supplies the remove callbacks;
// `formatLabels` ({ id: label }) comes from the backend's filter options.
export function buildFilterChips(state, actions, formatLabels) {
  const chips = [];
  if (state.mediaType) {
    chips.push({
      key: 'media',
      label: state.mediaType === 'video' ? 'Videos only' : 'Images only',
      onRemove: actions.removeMediaType,
    });
  }
  state.folders.forEach(path => {
    chips.push({
      key: `folder:${path}`,
      label: `Folder: ${folderBaseName(path)}`,
      onRemove: () => actions.removeFolder(path),
    });
  });
  const range = effectiveDateRange(state);
  if (range) {
    chips.push({ key: 'date', label: describeDate(state, range), onRemove: actions.removeDate });
  }
  if (state.orientations.length > 0) {
    chips.push({
      key: 'orientation',
      label: inCanonicalOrder(state.orientations, ORIENTATIONS).map(id => ORIENTATION_LABELS[id]).join(', '),
      onRemove: actions.removeOrientations,
    });
  }
  if (state.formats.length > 0) {
    chips.push({
      key: 'format',
      label: sortedFormats(state.formats).map(id => formatLabel(id, formatLabels)).join(', '),
      onRemove: actions.removeFormats,
    });
  }
  if (state.minMegapixels) {
    chips.push({ key: 'megapixels', label: `${GTE} ${state.minMegapixels} MP`, onRemove: actions.removeMegapixels });
  }
  return chips;
}
