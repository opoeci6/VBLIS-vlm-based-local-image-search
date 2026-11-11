/* global process */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import i18n from '../i18n';
import { useSearchFilters } from './useSearchFilters';

const API = 'http://127.0.0.1:8000';

const jsonResponse = (body) => ({ ok: true, json: async () => body });
const errorResponse = (status) => ({ ok: false, status, json: async () => ({ detail: 'nope' }) });
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

const OPTIONS = {
  total_files: 10,
  with_details: 8,
  unavailable: 0,
  missing_details: 0,
  media_types: { image: 8, video: 2 },
  formats: [{ id: 'jpeg', label: 'JPEG', media_type: 'image', count: 8 }],
  years: [{ year: 2024, count: 5 }],
  date_range: { from: '2024-01-01', to: '2024-12-31' },
  registry_available: true,
};

describe('useSearchFilters', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = (props = {}) => {
    const setToast = vi.fn();
    const hook = renderHook((p) => useSearchFilters({ setToast, ...p }), { initialProps: props });
    return { ...hook, setToast };
  };

  describe('request filters', () => {
    it('starts with no filters, no chips and a closed panel', () => {
      const { result } = render();
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.activeCount).toBe(0);
      expect(result.current.chips).toEqual([]);
      expect(result.current.isOpen).toBe(false);
    });

    it('maps each setter to its API key', () => {
      const { result } = render();

      act(() => result.current.setMediaType('video'));
      expect(result.current.requestFilters).toEqual({ media_type: 'video' });

      act(() => result.current.toggleOrientation('portrait'));
      act(() => result.current.toggleOrientation('square'));
      act(() => result.current.toggleFormat('mp4'));
      act(() => result.current.setMinMegapixels(8));
      act(() => result.current.toggleFolder('C:\\Photos'));
      act(() => result.current.setCustomDate({ from: '2024-01-01', to: '2024-03-31' }));

      expect(result.current.requestFilters).toEqual({
        media_type: 'video',
        folders: ['C:\\Photos'],
        date_from: '2024-01-01',
        date_to: '2024-03-31',
        orientations: ['portrait', 'square'],
        formats: ['mp4'],
        min_megapixels: 8,
      });
      expect(result.current.activeCount).toBe(6);
    });

    it('sends the chosen duplicate kinds, in a fixed order, and counts them once', () => {
      const { result } = render();
      expect(result.current.duplicates).toEqual([]);

      act(() => result.current.toggleDuplicate('visual'));
      expect(result.current.requestFilters).toEqual({ duplicates: ['visual'] });
      expect(result.current.activeCount).toBe(1);

      act(() => result.current.toggleDuplicate('exact'));
      expect(result.current.requestFilters).toEqual({ duplicates: ['exact', 'visual'] });
      expect(result.current.activeCount).toBe(1);

      act(() => result.current.toggleDuplicate('visual'));
      expect(result.current.requestFilters).toEqual({ duplicates: ['exact'] });
      act(() => result.current.toggleDuplicate('exact'));
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.activeCount).toBe(0);
    });

    it('toggles orientations and formats off again', () => {
      const { result } = render();
      act(() => result.current.toggleOrientation('portrait'));
      act(() => result.current.toggleOrientation('portrait'));
      act(() => result.current.toggleFormat('png'));
      act(() => result.current.toggleFormat('png'));
      expect(result.current.requestFilters).toBeNull();
    });

    it('keeps requestFilters referentially stable while the state does not change', () => {
      const { result, rerender } = render();
      act(() => result.current.setMediaType('image'));
      const first = result.current.requestFilters;
      rerender();
      expect(result.current.requestFilters).toBe(first);
      act(() => result.current.setMediaType('video'));
      expect(result.current.requestFilters).not.toBe(first);
    });

    it('keeps its actions and the chips stable across renders', () => {
      const { result, rerender } = render();
      act(() => result.current.setMediaType('image'));
      const { chips, clearAll, toggleFolder, close, toggleOpen } = result.current;
      rerender();
      expect(result.current.chips).toBe(chips);
      expect(result.current.clearAll).toBe(clearAll);
      expect(result.current.toggleFolder).toBe(toggleFolder);
      expect(result.current.close).toBe(close);
      expect(result.current.toggleOpen).toBe(toggleOpen);
    });

    it('clears everything with clearAll', () => {
      const { result } = render();
      act(() => {
        result.current.setMediaType('image');
        result.current.toggleFolder('/a');
        result.current.setDatePreset('year:2024');
        result.current.toggleOrientation('square');
        result.current.toggleFormat('png');
        result.current.setMinMegapixels(2);
        result.current.toggleDuplicate('exact');
        result.current.toggleDuplicate('visual');
      });
      expect(result.current.activeCount).toBe(7);
      act(() => result.current.clearAll());
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.activeCount).toBe(0);
      expect(result.current.duplicates).toEqual([]);
      expect(result.current.datePreset).toBeNull();
      expect(result.current.dateFrom).toBeNull();
    });
  });

  describe('chips', () => {
    it('removes a single filter through its chip', () => {
      const { result } = render();
      act(() => {
        result.current.setMediaType('image');
        result.current.toggleFolder('/photos/a');
        result.current.toggleFolder('/photos/b');
        result.current.toggleOrientation('square');
        result.current.toggleFormat('png');
        result.current.setMinMegapixels(12);
        result.current.setDatePreset('year:2024');
      });
      expect(result.current.chips.map(chip => chip.label)).toEqual([
        'Images only', 'Folder: a', 'Folder: b', '2024', 'Square', 'PNG', '\u2265 12 MP',
      ]);

      const remove = (label) => act(() => result.current.chips.find(chip => chip.label === label).onRemove());
      remove('Folder: a');
      expect(result.current.requestFilters.folders).toEqual(['/photos/b']);
      remove('2024');
      expect(result.current.requestFilters.date_from).toBeUndefined();
      expect(result.current.datePreset).toBeNull();
      remove('Square');
      remove('PNG');
      remove('\u2265 12 MP');
      remove('Images only');
      expect(result.current.requestFilters).toEqual({ folders: ['/photos/b'] });
    });
  });

  describe('duplicate chips', () => {
    it('has one removable chip per chosen kind', () => {
      const { result } = render();
      act(() => {
        result.current.toggleDuplicate('visual');
        result.current.toggleDuplicate('exact');
      });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['Exact copies', 'Visual duplicates']);

      act(() => result.current.chips.find(chip => chip.label === 'Exact copies').onRemove());
      expect(result.current.requestFilters).toEqual({ duplicates: ['visual'] });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['Visual duplicates']);

      act(() => result.current.chips[0].onRemove());
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.chips).toEqual([]);
    });
  });

  describe('places', () => {
    const japan = { id: 'JP', en: 'Japan', zh: '日本', count: 12, regions: [] };
    const kyoto = { id: 'JP.22', en: 'Kyoto Prefecture', zh: '京都府', count: 5, cities: [] };

    it('sends the chosen place ids sorted and counts them once', () => {
      const { result } = render();
      expect(result.current.places).toEqual([]);

      act(() => result.current.togglePlace({ id: 'CN.23', en: 'Heilongjiang', zh: '黑龙江' }));
      act(() => result.current.togglePlace(japan));
      expect(result.current.places).toEqual([
        { id: 'CN.23', en: 'Heilongjiang', zh: '黑龙江' },
        { id: 'JP', en: 'Japan', zh: '日本' },
      ]);
      expect(result.current.requestFilters).toEqual({ places: ['CN.23', 'JP'] });
      expect(result.current.activeCount).toBe(1);
      expect(result.current.detailsFilterActive).toBe(true);
    });

    it('applies the selection rules through togglePlace', () => {
      const { result } = render();
      act(() => result.current.togglePlace(kyoto));
      act(() => result.current.togglePlace(japan));
      expect(result.current.requestFilters).toEqual({ places: ['JP'] });

      const before = result.current.places;
      act(() => result.current.togglePlace(kyoto));
      expect(result.current.places).toBe(before);

      act(() => result.current.togglePlace(japan));
      expect(result.current.requestFilters).toBeNull();
    });

    it('has one removable chip per place, named in the interface language', async () => {
      const { result } = render();
      act(() => {
        result.current.togglePlace(japan);
        result.current.togglePlace({ id: 'CN.99', en: null, zh: null });
      });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['Place: Japan', 'Place: Other']);

      await act(async () => { await i18n.changeLanguage('zh-CN'); });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['地点：日本', '地点：其他']);

      act(() => result.current.chips[0].onRemove());
      expect(result.current.requestFilters).toEqual({ places: ['CN.99'] });
      act(() => result.current.chips[0].onRemove());
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.chips).toEqual([]);
    });

    it('is cleared by clearAll, keeping the chips stable when there was nothing to clear', () => {
      const { result } = render();
      const { places: untouched } = result.current;
      act(() => result.current.clearAll());
      expect(result.current.places).toBe(untouched);

      act(() => result.current.togglePlace(japan));
      expect(result.current.activeCount).toBe(1);
      act(() => result.current.clearAll());
      expect(result.current.places).toEqual([]);
      expect(result.current.requestFilters).toBeNull();
      expect(result.current.activeCount).toBe(0);
    });

    it('keeps togglePlace stable across renders', () => {
      const { result, rerender } = render();
      const { togglePlace } = result.current;
      act(() => result.current.togglePlace(japan));
      rerender();
      expect(result.current.togglePlace).toBe(togglePlace);
    });
  });

  describe('dates', () => {
    it('fills the dates from a preset using local calendar days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 15, 23, 30));
      const { result } = render();

      act(() => result.current.setDatePreset('last30'));
      expect(result.current.requestFilters).toEqual({ date_from: '2026-02-14', date_to: '2026-03-15' });
      act(() => result.current.setDatePreset('last12m'));
      expect(result.current.requestFilters).toEqual({ date_from: '2025-03-15', date_to: '2026-03-15' });
      act(() => result.current.setDatePreset('year:2023'));
      expect(result.current.requestFilters).toEqual({ date_from: '2023-01-01', date_to: '2023-12-31' });
      act(() => result.current.setDatePreset(null));
      expect(result.current.requestFilters).toBeNull();
    });

    it('does not shift the day through UTC near midnight', () => {
      const originalTz = process.env.TZ;
      process.env.TZ = 'America/Sao_Paulo';
      try {
        vi.useFakeTimers();
        // Dec 31, 22:00 local: already Jan 1 in UTC when the zone is UTC-3.
        vi.setSystemTime(new Date(2025, 11, 31, 22, 0));
        const { result } = render();
        act(() => result.current.setDatePreset('last30'));
        expect(result.current.requestFilters.date_to).toBe('2025-12-31');
      } finally {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      }
    });

    it('last12m on Feb 29 starts on Feb 28 a year earlier', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 1, 29, 12));
      const { result } = render();
      act(() => result.current.setDatePreset('last12m'));
      expect(result.current.requestFilters).toEqual({ date_from: '2023-02-28', date_to: '2024-02-29' });
    });

    it('custom keeps the current dates and accepts a single end', () => {
      const { result } = render();
      act(() => result.current.setDatePreset('year:2024'));
      act(() => result.current.setDatePreset('custom'));
      expect(result.current.datePreset).toBe('custom');
      expect(result.current.requestFilters).toEqual({ date_from: '2024-01-01', date_to: '2024-12-31' });

      act(() => result.current.setCustomDate({ from: '2024-05-01', to: '' }));
      expect(result.current.requestFilters).toEqual({ date_from: '2024-05-01' });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['From 2024-05-01']);
      act(() => result.current.setCustomDate({ from: '', to: '2024-06-01' }));
      expect(result.current.requestFilters).toEqual({ date_to: '2024-06-01' });
    });

    it('swaps a backwards custom range', () => {
      const { result } = render();
      act(() => result.current.setCustomDate({ from: '2024-06-01', to: '2024-01-01' }));
      expect(result.current.requestFilters).toEqual({ date_from: '2024-01-01', date_to: '2024-06-01' });
    });
  });

  describe('folders', () => {
    it('applies the selection rules through toggleFolder', () => {
      const { result } = render();
      act(() => result.current.toggleFolder('C:\\Photos\\2024'));
      act(() => result.current.toggleFolder('C:\\Photos2'));
      expect(result.current.folders).toEqual(['C:\\Photos\\2024', 'C:\\Photos2']);

      act(() => result.current.toggleFolder('c:/photos'));
      expect(result.current.folders).toEqual(['C:\\Photos2', 'c:/photos']);

      // A folder below a selected one is already included.
      act(() => result.current.toggleFolder('C:\\Photos\\2023'));
      expect(result.current.folders).toEqual(['C:\\Photos2', 'c:/photos']);

      act(() => result.current.toggleFolder('C:\\PHOTOS'));
      expect(result.current.folders).toEqual(['C:\\Photos2']);
    });
  });

  describe('options', () => {
    it('loads the options when the panel opens and not before', async () => {
      fetchMock.mockResolvedValue(jsonResponse(OPTIONS));
      const { result } = render();
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => { result.current.open(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${API}/search/filter-options`);
      expect(result.current.options).toEqual(OPTIONS);
      expect(result.current.optionsLoading).toBe(false);
      expect(result.current.optionsError).toBeNull();
    });

    it('reports a load failure and can retry', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500));
      const { result } = render();
      await act(async () => { result.current.open(); });
      expect(result.current.options).toBeNull();
      expect(result.current.optionsError).toBeTruthy();
      expect(result.current.optionsLoading).toBe(false);

      fetchMock.mockResolvedValueOnce(jsonResponse(OPTIONS));
      await act(async () => { await result.current.loadOptions(); });
      expect(result.current.options).toEqual(OPTIONS);
      expect(result.current.optionsError).toBeNull();
    });

    it('ignores a stale response when a newer load finished first', async () => {
      const first = deferred();
      const second = deferred();
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = render();

      await act(async () => { result.current.open(); });
      let reload;
      act(() => { reload = result.current.loadOptions(); });

      await act(async () => {
        second.resolve(jsonResponse({ ...OPTIONS, with_details: 10 }));
        await reload;
      });
      expect(result.current.options.with_details).toBe(10);

      await act(async () => {
        first.resolve(jsonResponse({ ...OPTIONS, with_details: 1 }));
        await first.promise;
      });
      expect(result.current.options.with_details).toBe(10);
      expect(result.current.optionsLoading).toBe(false);
    });

    it('drops a response that arrives after the panel was closed', async () => {
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);
      const { result } = render();
      await act(async () => { result.current.open(); });
      await act(async () => { result.current.close(); });

      await act(async () => {
        pending.resolve(jsonResponse(OPTIONS));
        await pending.promise;
      });
      expect(result.current.options).toBeNull();
    });

    it('reloads when the active task finishes while the panel is open', async () => {
      fetchMock.mockResolvedValue(jsonResponse(OPTIONS));
      const { result, rerender } = render({ activeTaskId: 'task-1' });
      await act(async () => { result.current.open(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => { rerender({ activeTaskId: null }); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not reload when a task starts, or while the panel is closed', async () => {
      fetchMock.mockResolvedValue(jsonResponse(OPTIONS));
      const { result, rerender } = render({ activeTaskId: null });
      await act(async () => { rerender({ activeTaskId: 'task-1' }); });
      await act(async () => { rerender({ activeTaskId: null }); });
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => { result.current.open(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => { rerender({ activeTaskId: 'task-2' }); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('readDetailsNow', () => {
    it('POSTs the scan and toasts when it was queued', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'queued', task_id: 't1' }));
      const { result, setToast } = render();
      await act(async () => { await result.current.readDetailsNow(); });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API}/index/media-info/scan`);
      expect(init.method).toBe('POST');
      expect(setToast).toHaveBeenCalledWith({ message: 'Reading media details in the background', type: 'info' });
      expect(result.current.isStartingScan).toBe(false);
    });

    it('toasts when a scan is already queued', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'duplicate', task_id: 't1' }));
      const { result, setToast } = render();
      await act(async () => { await result.current.readDetailsNow(); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Media details are already being read', type: 'info' });
    });

    it('toasts an error when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500));
      const { result, setToast } = render();
      await act(async () => { await result.current.readDetailsNow(); });
      expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

      fetchMock.mockRejectedValueOnce(new Error('down'));
      await act(async () => { await result.current.readDetailsNow(); });
      expect(setToast).toHaveBeenCalledTimes(2);
      expect(result.current.isStartingScan).toBe(false);
    });
  });
  describe('media details', () => {
    const SCAN_URL = `${API}/index/media-info/scan`;
    const scanCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === SCAN_URL);
    const optionCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === `${API}/search/filter-options`);

    let optionsPayload;
    let scanResponse;
    beforeEach(() => {
      optionsPayload = { ...OPTIONS, with_details: 5, total_files: 10, missing_details: 5 };
      scanResponse = { status: 'queued', task_id: 't1' };
      fetchMock.mockImplementation(async (url) => {
        const { pathname } = new URL(String(url));
        if (pathname === '/search/filter-options') return jsonResponse(optionsPayload);
        if (pathname === '/index/media-info/scan') return jsonResponse(scanResponse);
        return jsonResponse({});
      });
    });

    it('reads the details by itself when the options show files without them', async () => {
      const { result, setToast } = render();
      await act(async () => { result.current.open(); });

      expect(scanCalls()).toHaveLength(1);
      expect(scanCalls()[0][1].method).toBe('POST');
      expect(setToast).toHaveBeenCalledWith({
        message: 'Reading media details for 5 files in the background (no re-indexing needed)',
        type: 'info',
      });
      expect(result.current.missingDetails).toBe(5);
    });

    it('formats a large count in the toast', async () => {
      optionsPayload = { ...OPTIONS, total_files: 16140, with_details: 0, missing_details: 16140 };
      const { result, setToast } = render();
      await act(async () => { result.current.open(); });
      expect(setToast).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Reading media details for 16,140 files in the background (no re-indexing needed)',
      }));
    });

    it('does it at most once per session, even when the options load again', async () => {
      const { result } = render();
      await act(async () => { result.current.open(); });
      await act(async () => { result.current.close(); });
      await act(async () => { result.current.open(); });
      await act(async () => { await result.current.loadOptions(); });
      expect(optionCalls().length).toBeGreaterThanOrEqual(3);
      expect(scanCalls()).toHaveLength(1);
    });

    it('does not start a scan that is already active or pending, nor later ones', async () => {
      const { result, rerender, setToast } = render({ scanActive: true });
      await act(async () => { result.current.open(); });
      expect(scanCalls()).toHaveLength(0);
      expect(setToast).not.toHaveBeenCalled();

      // The scan ends but files are still missing (unreadable): no automatic second attempt.
      await act(async () => { rerender({ scanActive: false }); });
      await act(async () => { await result.current.loadOptions(); });
      expect(scanCalls()).toHaveLength(0);
    });

    it('does nothing when no file lacks details', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0 };
      const { result } = render();
      await act(async () => { result.current.open(); });
      expect(scanCalls()).toHaveLength(0);
      expect(result.current.missingDetails).toBe(0);
    });

    it('does nothing when the registry is unavailable', async () => {
      optionsPayload = { ...OPTIONS, registry_available: false, missing_details: 9 };
      const { result } = render();
      await act(async () => { result.current.open(); });
      expect(scanCalls()).toHaveLength(0);
      expect(result.current.missingDetails).toBe(0);
    });

    it('falls back to total - with details - unavailable when missing_details is absent', async () => {
      const { missing_details: _ignored, ...withoutKey } = OPTIONS;
      optionsPayload = { ...withoutKey, total_files: 10, with_details: 4, unavailable: 1 };
      const { result } = render();
      await act(async () => { result.current.open(); });
      expect(result.current.missingDetails).toBe(5);
      expect(scanCalls()).toHaveLength(1);
    });

    it('stays silent when the automatic start finds a scan already queued', async () => {
      scanResponse = { status: 'duplicate', task_id: 't1' };
      const { result, setToast } = render();
      await act(async () => { result.current.open(); });
      expect(scanCalls()).toHaveLength(1);
      expect(setToast).not.toHaveBeenCalled();
    });

    it('still lets the user start a scan by hand afterwards', async () => {
      const { result, setToast } = render();
      await act(async () => { result.current.open(); });
      setToast.mockClear();
      await act(async () => { await result.current.readDetailsNow(); });
      expect(scanCalls()).toHaveLength(2);
      expect(setToast).toHaveBeenCalledWith({ message: 'Reading media details in the background', type: 'info' });
    });

    it('reloads the options when the scan leaves the queue, whatever the running task id did', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0 };
      const { result, rerender } = render({ scanActive: true, activeTaskId: null });
      await act(async () => { result.current.open(); });
      expect(optionCalls()).toHaveLength(1);

      await act(async () => { rerender({ scanActive: false, activeTaskId: null }); });
      expect(optionCalls()).toHaveLength(2);
    });

    it('reloads once when both the task id and the scan state change together', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0 };
      const { result, rerender } = render({ scanActive: true, activeTaskId: 'scan-1' });
      await act(async () => { result.current.open(); });
      await act(async () => { rerender({ scanActive: false, activeTaskId: null }); });
      expect(optionCalls()).toHaveLength(2);
    });

    it('does not reload when the scan ends while the panel is closed and no details filter is active', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0 };
      const { rerender } = render({ scanActive: true });
      await act(async () => { rerender({ scanActive: false }); });
      expect(optionCalls()).toHaveLength(0);
    });

    it('reloads when the scan ends with the panel closed but a details filter active', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0 };
      const { result, rerender } = render({ scanActive: true });
      act(() => result.current.toggleOrientation('portrait'));
      await act(async () => { rerender({ scanActive: false }); });
      expect(optionCalls()).toHaveLength(1);
    });

    it('reports whether a filter that needs media details is active', () => {
      const { result } = render();
      expect(result.current.detailsFilterActive).toBe(false);
      act(() => result.current.setMediaType('image'));
      act(() => result.current.toggleFormat('png'));
      expect(result.current.detailsFilterActive).toBe(false);
      act(() => result.current.setMinMegapixels(8));
      expect(result.current.detailsFilterActive).toBe(true);
      act(() => result.current.setMinMegapixels(null));
      act(() => result.current.setCustomDate({ from: '2024-01-01', to: '' }));
      expect(result.current.detailsFilterActive).toBe(true);
    });

    it('names a format in the chip with the label the backend gave it', async () => {
      optionsPayload = { ...OPTIONS, missing_details: 0, formats: [{ id: 'avif', label: 'AVIF', media_type: 'image', count: 3 }] };
      const { result } = render();
      act(() => result.current.toggleFormat('avif'));
      expect(result.current.chips.map(chip => chip.label)).toEqual(['AVIF']);
      await act(async () => { result.current.open(); });
      expect(result.current.chips.map(chip => chip.label)).toEqual(['AVIF']);

      const before = result.current.chips;
      await act(async () => { await result.current.loadOptions(); });
      expect(result.current.chips).toBe(before);
    });
  });
});
