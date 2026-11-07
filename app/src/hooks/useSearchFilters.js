import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';
import { apiFetch } from '../utils/api';
import {
  buildFilterChips,
  buildRequestFilters,
  cleanDate,
  countActiveFilters,
  countMissingDetails,
  hasDetailsFilter,
  resolveDatePreset,
  toggleFolderSelection
} from '../utils/searchFilters';

const toggleInList = (list, value) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);

// State of the search filters, the request object derived from it, the pills shown for active
// filters and the filter-options data (formats, years, coverage) loaded while the panel is open.
// Nothing here is persisted: filters reset when the app restarts.
// `activeTaskId` is the id of the running background task; `scanActive` is true while a media
// details scan (SCAN_MEDIA_INFO) is running or waiting in the queue.
export const useSearchFilters = ({ setToast, activeTaskId = null, scanActive = false } = {}) => {
  const [mediaType, setMediaType] = useState(null);
  const [folders, setFolders] = useState([]);
  const [datePreset, setDatePresetState] = useState(null);
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [orientations, setOrientations] = useState([]);
  const [formats, setFormats] = useState([]);
  const [minMegapixels, setMinMegapixels] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const [options, setOptions] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(null);
  const [isStartingScan, setIsStartingScan] = useState(false);
  const optionsSeq = useRef(0);
  const setToastRef = useRef(setToast);
  setToastRef.current = setToast;

  const filterState = useMemo(
    () => ({ mediaType, folders, datePreset, dateFrom, dateTo, orientations, formats, minMegapixels }),
    [mediaType, folders, datePreset, dateFrom, dateTo, orientations, formats, minMegapixels]
  );

  // Null while nothing is active; the same object while the filter state is unchanged.
  const requestFilters = useMemo(() => buildRequestFilters(filterState), [filterState]);
  const activeCount = useMemo(() => countActiveFilters(filterState), [filterState]);

  const toggleFolder = useCallback((path) => {
    setFolders(prev => toggleFolderSelection(prev, path));
  }, []);

  // A preset fills in the dates now (relative presets are fixed to the day they were chosen);
  // 'custom' keeps the dates already shown so the inputs start from the current range.
  const setDatePreset = useCallback((preset) => {
    if (!preset) {
      setDatePresetState(null);
      setDateFrom(null);
      setDateTo(null);
      return;
    }
    if (preset === 'custom') {
      setDatePresetState('custom');
      return;
    }
    const range = resolveDatePreset(preset);
    if (!range) return;
    setDatePresetState(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, []);

  // Either end may be empty. A range typed backwards is swapped when the request is built.
  const setCustomDate = useCallback(({ from = null, to = null } = {}) => {
    setDatePresetState('custom');
    setDateFrom(cleanDate(from));
    setDateTo(cleanDate(to));
  }, []);

  const toggleOrientation = useCallback((value) => setOrientations(prev => toggleInList(prev, value)), []);
  const toggleFormat = useCallback((value) => setFormats(prev => toggleInList(prev, value)), []);

  const clearAll = useCallback(() => {
    setMediaType(null);
    setFolders(prev => (prev.length === 0 ? prev : []));
    setDatePresetState(null);
    setDateFrom(null);
    setDateTo(null);
    setOrientations(prev => (prev.length === 0 ? prev : []));
    setFormats(prev => (prev.length === 0 ? prev : []));
    setMinMegapixels(null);
  }, []);

  const chipActions = useMemo(() => ({
    removeMediaType: () => setMediaType(null),
    removeFolder: (path) => setFolders(prev => prev.filter(item => item !== path)),
    removeDate: () => {
      setDatePresetState(null);
      setDateFrom(null);
      setDateTo(null);
    },
    removeOrientations: () => setOrientations([]),
    removeFormats: () => setFormats([]),
    removeMegapixels: () => setMinMegapixels(null)
  }), []);

  // Labels of the formats in the index, as the backend names them. Keyed by a string so the chips
  // (and the memoized results console they are passed to) only change when a label does.
  const formatLabelsKey = options?.formats ? JSON.stringify(options.formats.map(item => [item.id, item.label])) : '';
  const formatLabels = useMemo(
    () => (formatLabelsKey ? Object.fromEntries(JSON.parse(formatLabelsKey)) : null),
    [formatLabelsKey]
  );

  const chips = useMemo(
    () => buildFilterChips(filterState, chipActions, formatLabels),
    [filterState, chipActions, formatLabels]
  );

  const detailsFilterActive = hasDetailsFilter(requestFilters);
  const missingDetails = countMissingDetails(options);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggleOpen = useCallback(() => setIsOpen(prev => !prev), []);

  const loadOptions = useCallback(async () => {
    const seq = ++optionsSeq.current;
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const res = await apiFetch(`${API_BASE}/search/filter-options`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== optionsSeq.current) return;
      setOptions(data);
    } catch (err) {
      console.error(err);
      if (seq !== optionsSeq.current) return;
      setOptionsError('Could not load the filter options.');
    } finally {
      if (seq === optionsSeq.current) setOptionsLoading(false);
    }
  }, []);

  // Load when the panel opens. Closing it drops any response still on its way.
  useEffect(() => {
    if (isOpen) {
      loadOptions();
    } else {
      optionsSeq.current += 1;
    }
  }, [isOpen, loadOptions]);

  // A finished background task (an index run or a media details scan) changes the counts. Reload
  // while the panel is open, or while a details filter is active (the "no matches" hint uses them).
  // Detected both by the running task changing and by the scan leaving the queue.
  const previousTaskId = useRef(activeTaskId);
  const previousScanActive = useRef(scanActive);
  useEffect(() => {
    const taskChanged = Boolean(previousTaskId.current) && previousTaskId.current !== activeTaskId;
    const scanFinished = previousScanActive.current && !scanActive;
    previousTaskId.current = activeTaskId;
    previousScanActive.current = scanActive;
    if ((taskChanged || scanFinished) && (isOpen || detailsFilterActive)) loadOptions();
  }, [activeTaskId, scanActive, isOpen, detailsFilterActive, loadOptions]);

  // Starts the media details scan. `autoFor` is the number of files an automatic start is for: it
  // changes the toast, and an automatic start says nothing when a scan was already queued.
  const requestScan = useCallback(async (autoFor = null) => {
    setIsStartingScan(true);
    try {
      const res = await apiFetch(`${API_BASE}/index/media-info/scan`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.status === 'duplicate') {
        if (autoFor === null) setToastRef.current?.({ message: 'Media details are already being read', type: 'info' });
      } else if (autoFor === null) {
        setToastRef.current?.({ message: 'Reading media details in the background', type: 'info' });
      } else {
        setToastRef.current?.({
          message: `Reading media details for ${autoFor.toLocaleString('en-US')} files in the background (no re-indexing needed)`,
          type: 'info'
        });
      }
    } catch (err) {
      console.error(err);
      setToastRef.current?.({ message: 'Failed to start reading media details.', type: 'error' });
    } finally {
      setIsStartingScan(false);
    }
  }, []);

  const readDetailsNow = useCallback(() => requestScan(), [requestScan]);

  // Files without media details are skipped by the date, orientation and resolution filters. The
  // scan only reads file headers, so start it by itself the first time the options show some are
  // missing: at most once per app session, and not when a scan is already queued or running.
  const scanActiveRef = useRef(scanActive);
  scanActiveRef.current = scanActive;
  const autoReadDecided = useRef(false);
  useEffect(() => {
    if (!options || autoReadDecided.current) return;
    const missing = countMissingDetails(options);
    if (missing <= 0) return;
    autoReadDecided.current = true;
    if (!scanActiveRef.current) requestScan(missing);
  }, [options, requestScan]);

  return {
    mediaType,
    folders,
    datePreset,
    dateFrom,
    dateTo,
    orientations,
    formats,
    minMegapixels,
    requestFilters,
    activeCount,
    chips,
    setMediaType,
    toggleFolder,
    setDatePreset,
    setCustomDate,
    toggleOrientation,
    toggleFormat,
    setMinMegapixels,
    clearAll,
    isOpen,
    open,
    close,
    toggleOpen,
    options,
    optionsLoading,
    optionsError,
    loadOptions,
    readDetailsNow,
    isStartingScan,
    scanActive,
    missingDetails,
    detailsFilterActive
  };
};
