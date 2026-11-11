/* global process */
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import {
  buildFilterChips,
  getDuplicateLabels,
  getOrientationLabels,
  buildRequestFilters,
  countActiveFilters,
  countMissingDetails,
  effectiveDateRange,
  findSelectedAncestor,
  folderBaseName,
  formatLabel,
  formatLocalDate,
  hasDetailsFilter,
  isFolderSelected,
  isInsideFolder,
  normalizeFolderPath,
  resolveDatePreset,
  toggleFolderSelection,
} from './searchFilters';

const emptyState = {
  mediaType: null,
  folders: [],
  datePreset: null,
  dateFrom: null,
  dateTo: null,
  orientations: [],
  formats: [],
  minMegapixels: null,
  duplicates: [],
};

describe('folder paths', () => {
  it('treats separators and case alike and ignores a trailing separator', () => {
    expect(normalizeFolderPath('C:\\Photos\\Trips\\')).toBe('c:/photos/trips');
    expect(normalizeFolderPath('c:/PHOTOS//trips')).toBe('c:/photos/trips');
  });

  it('knows what lies inside a folder, by whole path segments only', () => {
    expect(isInsideFolder('C:\\Photos\\2024', 'c:/photos')).toBe(true);
    expect(isInsideFolder('C:\\Photos2', 'C:\\Photos')).toBe(false);
    expect(isInsideFolder('C:\\Photos', 'C:\\Photos')).toBe(false);
    expect(isInsideFolder('/a', '')).toBe(false);
  });

  it('finds the selected folder that covers a path', () => {
    expect(findSelectedAncestor(['C:\\Photos'], 'c:/photos/2024')).toBe('C:\\Photos');
    expect(findSelectedAncestor(['C:\\Photos'], 'C:\\Photos')).toBeNull();
    expect(findSelectedAncestor(['C:\\Photos'], 'C:\\Photos2')).toBeNull();
  });

  it('gets a folder base name, falling back to the path', () => {
    expect(folderBaseName('C:\\Photos\\Trips')).toBe('Trips');
    expect(folderBaseName('/photos/trips/')).toBe('trips');
    expect(folderBaseName('/')).toBe('/');
  });
});

describe('toggleFolderSelection', () => {
  it('adds a folder', () => {
    expect(toggleFolderSelection([], 'C:\\Photos')).toEqual(['C:\\Photos']);
  });

  it('removes a selected folder, matching case and separators loosely', () => {
    expect(toggleFolderSelection(['C:\\Photos', 'D:\\Other'], 'c:/photos')).toEqual(['D:\\Other']);
  });

  it('drops selected descendants when their ancestor is selected', () => {
    const next = toggleFolderSelection(['C:\\Photos\\2024', 'C:\\Photos\\2023', 'D:\\Other'], 'C:\\Photos');
    expect(next).toEqual(['D:\\Other', 'C:\\Photos']);
  });

  it('does nothing for a folder below a selected one', () => {
    const selected = ['C:\\Photos'];
    expect(toggleFolderSelection(selected, 'C:\\Photos\\2024')).toBe(selected);
  });

  it('keeps a sibling with a shared name prefix separate', () => {
    expect(toggleFolderSelection(['C:\\Photos'], 'C:\\Photos2')).toEqual(['C:\\Photos', 'C:\\Photos2']);
    expect(toggleFolderSelection(['C:\\Photos2'], 'C:\\Photos')).toEqual(['C:\\Photos2', 'C:\\Photos']);
    expect(isFolderSelected(['C:\\Photos2'], 'C:\\Photos')).toBe(false);
  });
});

describe('dates', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('formats the local calendar day, not the UTC day', () => {
    process.env.TZ = 'America/Sao_Paulo';
    // 22:00 on Dec 31 local time is already Jan 1 in UTC (when the zone is UTC-3).
    const late = new Date(2025, 11, 31, 22, 0, 0);
    expect(formatLocalDate(late)).toBe('2025-12-31');
    expect(resolveDatePreset('last30', late).to).toBe('2025-12-31');
  });

  it('last30 covers today and the 29 days before it', () => {
    expect(resolveDatePreset('last30', new Date(2026, 2, 15))).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    expect(resolveDatePreset('last30', new Date(2026, 0, 10))).toEqual({ from: '2025-12-12', to: '2026-01-10' });
  });

  it('last12m starts on the same calendar date a year ago', () => {
    expect(resolveDatePreset('last12m', new Date(2026, 5, 20))).toEqual({ from: '2025-06-20', to: '2026-06-20' });
  });

  it('last12m on Feb 29 starts on Feb 28 of the previous year', () => {
    expect(resolveDatePreset('last12m', new Date(2024, 1, 29))).toEqual({ from: '2023-02-28', to: '2024-02-29' });
  });

  it('a year preset spans the whole year', () => {
    expect(resolveDatePreset('year:2024')).toEqual({ from: '2024-01-01', to: '2024-12-31' });
  });

  it('returns null for presets it does not know', () => {
    expect(resolveDatePreset('custom')).toBeNull();
    expect(resolveDatePreset('nonsense')).toBeNull();
  });

  it('swaps a custom range typed backwards and ignores malformed dates', () => {
    expect(effectiveDateRange({ datePreset: 'custom', dateFrom: '2024-05-01', dateTo: '2024-01-01' }))
      .toEqual({ from: '2024-01-01', to: '2024-05-01' });
    expect(effectiveDateRange({ datePreset: 'custom', dateFrom: '2024-05', dateTo: null })).toBeNull();
    expect(effectiveDateRange({ datePreset: null, dateFrom: '2024-05-01', dateTo: null })).toBeNull();
    expect(effectiveDateRange({ datePreset: 'custom', dateFrom: null, dateTo: '2024-05-01' }))
      .toEqual({ from: null, to: '2024-05-01' });
  });
});

describe('buildRequestFilters', () => {
  it('is null when nothing is active', () => {
    expect(buildRequestFilters(emptyState)).toBeNull();
    expect(countActiveFilters(emptyState)).toBe(0);
  });

  it('maps every filter to its API key and leaves inactive ones out', () => {
    const state = {
      mediaType: 'image',
      folders: ['C:\\Photos'],
      datePreset: 'custom',
      dateFrom: '2024-01-01',
      dateTo: '2024-03-31',
      orientations: ['square', 'landscape'],
      formats: ['heic', 'jpeg'],
      minMegapixels: 12,
    };
    expect(buildRequestFilters(state)).toEqual({
      media_type: 'image',
      folders: ['C:\\Photos'],
      date_from: '2024-01-01',
      date_to: '2024-03-31',
      orientations: ['landscape', 'square'],
      formats: ['heic', 'jpeg'],
      min_megapixels: 12,
    });
    expect(countActiveFilters(state)).toBe(6);
  });

  it('sends the duplicate kinds in a fixed order, only when some are chosen', () => {
    expect(buildRequestFilters({ ...emptyState, duplicates: ['exact'] })).toEqual({ duplicates: ['exact'] });
    expect(buildRequestFilters({ ...emptyState, duplicates: ['visual', 'exact'] })).toEqual({ duplicates: ['exact', 'visual'] });
    expect(buildRequestFilters(emptyState)).toBeNull();
    expect(countActiveFilters({ ...emptyState, duplicates: ['visual', 'exact'] })).toBe(1);
  });

  it('sends only one date end when the other is empty', () => {
    expect(buildRequestFilters({ ...emptyState, datePreset: 'custom', dateFrom: '2024-01-01' }))
      .toEqual({ date_from: '2024-01-01' });
    expect(buildRequestFilters({ ...emptyState, datePreset: 'custom', dateTo: '2024-03-31' }))
      .toEqual({ date_to: '2024-03-31' });
  });
});

describe('buildFilterChips', () => {
  const actions = {
    removeMediaType: () => {},
    removeFolder: () => {},
    removeDate: () => {},
    removeOrientations: () => {},
    removeFormats: () => {},
    removeMegapixels: () => {},
    removeDuplicate: () => {},
  };
  const labels = (state) => buildFilterChips({ ...emptyState, ...state }, actions).map(chip => chip.label);

  it('labels media type, folders, orientation, format and resolution', () => {
    expect(labels({ mediaType: 'image' })).toEqual(['Images only']);
    expect(labels({ mediaType: 'video' })).toEqual(['Videos only']);
    expect(labels({ folders: ['C:\\Photos\\Trips', '/data/pets'] })).toEqual(['Folder: Trips', 'Folder: pets']);
    expect(labels({ orientations: ['square', 'portrait'] })).toEqual(['Portrait, Square']);
    expect(labels({ formats: ['jpeg', 'heic', 'webm'] })).toEqual(['HEIC, JPEG, WebM']);
    expect(labels({ minMegapixels: 12 })).toEqual(['\u2265 12 MP']);
  });

  it('labels the duplicate kinds, exact first', () => {
    expect(labels({ duplicates: ['exact'] })).toEqual(['Exact copies']);
    expect(labels({ duplicates: ['visual'] })).toEqual(['Visual duplicates']);
    expect(labels({ duplicates: ['visual', 'exact'] })).toEqual(['Exact copies', 'Visual duplicates']);
  });

  it('labels the date presets and custom ranges', () => {
    expect(labels({ datePreset: 'last30', dateFrom: '2026-02-14', dateTo: '2026-03-15' })).toEqual(['Last 30 days']);
    expect(labels({ datePreset: 'last12m', dateFrom: '2025-06-20', dateTo: '2026-06-20' })).toEqual(['Last 12 months']);
    expect(labels({ datePreset: 'year:2024', dateFrom: '2024-01-01', dateTo: '2024-12-31' })).toEqual(['2024']);
    expect(labels({ datePreset: 'custom', dateFrom: '2024-01-01', dateTo: '2024-03-31' })).toEqual(['2024-01-01 \u2013 2024-03-31']);
    expect(labels({ datePreset: 'custom', dateFrom: '2024-01-01' })).toEqual(['From 2024-01-01']);
    expect(labels({ datePreset: 'custom', dateTo: '2024-03-31' })).toEqual(['Until 2024-03-31']);
  });

  it('has no chip for an empty custom range', () => {
    expect(labels({ datePreset: 'custom' })).toEqual([]);
  });

  it('gives each chip a unique key', () => {
    const chips = buildFilterChips({ ...emptyState, mediaType: 'image', folders: ['/a', '/b'], minMegapixels: 2, duplicates: ['exact', 'visual'] }, actions);
    expect(new Set(chips.map(chip => chip.key)).size).toBe(6);
  });
describe('formats from the backend', () => {
  it('sends any format id, sorted, including ones the app does not know', () => {
    expect(buildRequestFilters({ ...emptyState, formats: ['webp', 'avif', 'jpeg'] }))
      .toEqual({ formats: ['avif', 'jpeg', 'webp'] });
  });

  it('prefers the backend label, then the built-in one, then the upper-cased id', () => {
    expect(formatLabel('avif', { avif: 'AVIF (modern)' })).toBe('AVIF (modern)');
    expect(formatLabel('webp', null)).toBe('WebP');
    expect(formatLabel('webp', { jpeg: 'JPEG' })).toBe('WebP');
    expect(formatLabel('avif', null)).toBe('AVIF');
    expect(formatLabel('jxl', {})).toBe('JXL');
  });

  it('uses those labels in the chip', () => {
    const noop = () => {};
    const actions = { removeMediaType: noop, removeFolder: noop, removeDate: noop, removeOrientations: noop, removeFormats: noop, removeMegapixels: noop };
    const chips = buildFilterChips({ ...emptyState, formats: ['jxl', 'avif', 'jpeg'] }, actions, { avif: 'AVIF' });
    expect(chips.map(chip => chip.label)).toEqual(['AVIF, JPEG, JXL']);
  });
});

describe('countMissingDetails', () => {
  it('uses missing_details when the backend reports it', () => {
    expect(countMissingDetails({ total_files: 100, with_details: 60, unavailable: 10, missing_details: 7 })).toBe(7);
    expect(countMissingDetails({ total_files: 100, with_details: 100, unavailable: 0, missing_details: 0 })).toBe(0);
  });

  it('derives it from the other counts when the key is absent', () => {
    expect(countMissingDetails({ total_files: 100, with_details: 60, unavailable: 10 })).toBe(30);
    expect(countMissingDetails({ total_files: 10, with_details: 10, unavailable: 5 })).toBe(0);
  });

  it('is 0 without options, with an empty payload, or without the registry', () => {
    expect(countMissingDetails(null)).toBe(0);
    expect(countMissingDetails({})).toBe(0);
    expect(countMissingDetails({ total_files: 10, with_details: 0, registry_available: false })).toBe(0);
  });
});

describe('hasDetailsFilter', () => {
  it('is true only for date, orientation and resolution filters', () => {
    expect(hasDetailsFilter(null)).toBe(false);
    expect(hasDetailsFilter({ media_type: 'image', formats: ['png'], folders: ['/a'] })).toBe(false);
    expect(hasDetailsFilter({ date_from: '2024-01-01' })).toBe(true);
    expect(hasDetailsFilter({ date_to: '2024-01-01' })).toBe(true);
    expect(hasDetailsFilter({ orientations: ['square'] })).toBe(true);
    expect(hasDetailsFilter({ min_megapixels: 2 })).toBe(true);
  });
});
});

describe('translated labels', () => {
  it('has label getters for orientations and duplicate kinds', () => {
    expect(getOrientationLabels()).toEqual({ landscape: 'Landscape', portrait: 'Portrait', square: 'Square' });
    expect(getDuplicateLabels()).toEqual({ exact: 'Exact copies', visual: 'Visual duplicates' });
  });

  it('follows the interface language when it changes', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(getOrientationLabels().portrait).toBe('纵向');
    expect(getDuplicateLabels()).toEqual({ exact: '完全相同的副本', visual: '视觉重复' });
  });

  it('translates every chip in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    const state = {
      mediaType: 'video',
      folders: ['C:\\Photos\\Trips'],
      datePreset: 'custom',
      dateFrom: '2024-01-01',
      dateTo: '2024-03-31',
      orientations: ['square'],
      formats: ['jpeg'],
      minMegapixels: 12,
      duplicates: ['exact', 'visual'],
    };
    const noop = () => {};
    const actions = {
      removeMediaType: noop, removeFolder: noop, removeDate: noop, removeOrientations: noop,
      removeFormats: noop, removeMegapixels: noop, removeDuplicate: noop,
    };
    expect(buildFilterChips(state, actions, undefined).map(chip => chip.label)).toEqual([
      '仅视频',
      '文件夹：Trips',
      '2024-01-01 – 2024-03-31',
      '正方形',
      'JPEG',
      '≥ 12 MP',
      '完全相同的副本',
      '视觉重复',
    ]);
  });

  it('uses the translator it is given', () => {
    const t = (key) => `<${key}>`;
    const state = { mediaType: 'image', folders: [], orientations: [], formats: [], duplicates: ['visual'] };
    const labels = buildFilterChips(state, {}, undefined, t).map(chip => chip.label);
    expect(labels).toEqual(['<filters:chip.imagesOnly>', '<filters:duplicates.visual>']);
  });

  it('keeps a folder name that looks like a nested translation as plain text', () => {
    const state = { folders: ['/data/$t(common.cancel)'], orientations: [], formats: [], duplicates: [] };
    expect(buildFilterChips(state, { removeFolder: () => {} }, undefined).map(chip => chip.label))
      .toEqual(['Folder: $t(common.cancel)']);
  });
});

describe('place filter', () => {
  const japan = { id: 'JP', en: 'Japan', zh: '日本' };
  const kyoto = { id: 'JP.22', en: 'Kyoto Prefecture', zh: null };
  const nameless = { id: 'CN.99', en: null, zh: null };
  const noop = () => {};

  it('sends the place ids sorted, and leaves the key out when none is chosen', () => {
    expect(buildRequestFilters({ ...emptyState, places: [kyoto, nameless, japan] }))
      .toEqual({ places: ['CN.99', 'JP', 'JP.22'] });
    expect(buildRequestFilters({ ...emptyState, places: [] })).toBeNull();
    expect(buildRequestFilters(emptyState)).toBeNull();
  });

  it('still works with a state that has no places field', () => {
    const { places: _ignored, ...withoutPlaces } = { ...emptyState, places: [] };
    expect(buildRequestFilters(withoutPlaces)).toBeNull();
    expect(countActiveFilters(withoutPlaces)).toBe(0);
    expect(buildFilterChips(withoutPlaces, {}).map(chip => chip.label)).toEqual([]);
  });

  it('counts the places as one kind', () => {
    expect(countActiveFilters({ ...emptyState, places: [japan] })).toBe(1);
    expect(countActiveFilters({ ...emptyState, places: [japan, kyoto] })).toBe(1);
    expect(countActiveFilters({ ...emptyState, mediaType: 'image', places: [japan, kyoto] })).toBe(2);
  });

  it('counts as a details filter, because the GPS position comes with the media details', () => {
    expect(hasDetailsFilter({ places: ['JP'] })).toBe(true);
    expect(hasDetailsFilter({ media_type: 'image' })).toBe(false);
    expect(hasDetailsFilter(buildRequestFilters({ ...emptyState, places: [japan] }))).toBe(true);
  });

  it('has one chip per place, named in the interface language', async () => {
    const state = { ...emptyState, places: [japan, kyoto] };
    const chips = buildFilterChips(state, { removePlace: noop });
    expect(chips.map(chip => chip.label)).toEqual(['Place: Japan', 'Place: Kyoto Prefecture']);
    expect(chips.map(chip => chip.key)).toEqual(['place:JP', 'place:JP.22']);

    await i18n.changeLanguage('zh-CN');
    expect(buildFilterChips(state, { removePlace: noop }).map(chip => chip.label)).toEqual(['地点：日本', '地点：Kyoto Prefecture']);
  });

  it('takes the language of the names from its last argument', () => {
    const state = { ...emptyState, places: [japan] };
    expect(buildFilterChips(state, {}, undefined, i18n.t, 'zh-CN').map(chip => chip.label)).toEqual(['Place: 日本']);
  });

  it('names a region without names Other', async () => {
    const state = { ...emptyState, places: [nameless] };
    expect(buildFilterChips(state, {}).map(chip => chip.label)).toEqual(['Place: Other']);
    await i18n.changeLanguage('zh-CN');
    expect(buildFilterChips(state, {}).map(chip => chip.label)).toEqual(['地点：其他']);
  });

  it('removes a place through its chip by id', () => {
    const removePlace = vi.fn();
    const chips = buildFilterChips({ ...emptyState, places: [japan, kyoto] }, { removePlace });
    chips[1].onRemove();
    expect(removePlace).toHaveBeenCalledTimes(1);
    expect(removePlace).toHaveBeenCalledWith('JP.22');
  });

  it('puts the place chips after the duplicate chips with unique keys', () => {
    const state = { ...emptyState, mediaType: 'image', duplicates: ['exact'], places: [japan, kyoto] };
    const chips = buildFilterChips(state, {});
    expect(chips.map(chip => chip.label)).toEqual(['Images only', 'Exact copies', 'Place: Japan', 'Place: Kyoto Prefecture']);
    expect(new Set(chips.map(chip => chip.key)).size).toBe(4);
  });
});
