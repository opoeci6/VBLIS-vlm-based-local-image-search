import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';
import { annotateDuplicates, groupVideoResults, getImageResults, countSearchResults } from '../utils/searchResults';
import { useProgressiveList } from './useProgressiveList';
import { apiFetch } from '../utils/api';
import { readJson, writeJson } from '../utils/storage';

// Wait this long after the last filter change before re-running the current search.
const FILTER_RERUN_DELAY_MS = 250;

export const SEARCH_TUNING_DEFAULTS = { minScore: 0.10, minSimilarity: 0.70, maxResults: 50 };

const SEARCH_TUNING_KEY = 'search_tuning';

const isNumberInRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// Each saved field is checked on its own against its slider's range; a bad one falls back to its default.
const loadSearchTuning = () => {
  const saved = readJson(SEARCH_TUNING_KEY, null);
  const source = saved && typeof saved === 'object' ? saved : {};
  const { minScore, minSimilarity, maxResults } = source;
  return {
    minScore: isNumberInRange(minScore, 0.01, 0.95) ? minScore : SEARCH_TUNING_DEFAULTS.minScore,
    minSimilarity: isNumberInRange(minSimilarity, 0.30, 0.95) ? minSimilarity : SEARCH_TUNING_DEFAULTS.minSimilarity,
    maxResults: isNumberInRange(maxResults, 0, 250) && Number.isInteger(maxResults) && maxResults % 5 === 0
      ? maxResults
      : SEARCH_TUNING_DEFAULTS.maxResults,
  };
};

const postJson = (path, body) => apiFetch(`${API_BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// `filters` is the request object from useSearchFilters (null when no filter is active). It is
// sent with every search and, when it changes, the search behind the current results is re-run.
export const useMediaSearch = ({ setToast, onSearchStart, onClose, filters = null }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  // The three search sliders are remembered across restarts.
  const [savedTuning] = useState(loadSearchTuning);
  const [minScore, setMinScore] = useState(savedTuning.minScore);
  const [minSimilarity, setMinSimilarity] = useState(savedTuning.minSimilarity);
  const [maxResults, setMaxResults] = useState(savedTuning.maxResults);
  const [visibleResultsCount, setVisibleResultsCount] = useState(80);
  const [imageSearchContext, setImageSearchContext] = useState(null);
  // Request body of the last submitted text search, so it can be re-run after the index changes.
  const lastTextSearchBody = useRef(null);
  // How the current results were produced: { kind: 'text' | 'image', topK, minScore, query, queryRef }.
  // Refresh and "find more frames" reuse the minimum that search used, not the slider's current value.
  // Kept in state for rendering and mirrored in a ref so the callbacks below can stay stable.
  const [searchInfo, setSearchInfo] = useState(null);
  const searchInfoRef = useRef(null);
  const [expandedFramesByPath, setExpandedFramesByPath] = useState({});
  const [expandingVideoPath, setExpandingVideoPath] = useState(null);
  // Bumped whenever the results are replaced or cleared, so late expand responses can be dropped.
  const generation = useRef(0);
  // Paths with an expand request in flight; replaced on reset so old requests cannot block new ones.
  const expandInFlight = useRef(new Set());
  const setToastRef = useRef(setToast);
  setToastRef.current = setToast;
  // Read when a request is built, so callbacks need not be recreated when the filters change.
  const filtersRef = useRef(null);
  filtersRef.current = filters ?? null;
  const hasSearchedRef = useRef(false);
  hasSearchedRef.current = hasSearched;
  // Every search-type request (search, image search, refresh, filter re-run) takes the next number;
  // only the response of the latest one is applied, so a slow older request cannot overwrite it.
  const searchSeq = useRef(0);
  // The latest search-type request while it is in flight: its number and the filters it was sent with.
  const pendingSearch = useRef(null);
  // Number of the request whose results were applied last.
  const appliedSeq = useRef(0);
  const filtersKey = filters ? JSON.stringify(filters) : '';
  const filtersKeyRef = useRef(filtersKey);
  filtersKeyRef.current = filtersKey;
  const rerunForFiltersRef = useRef(null);
  const filterRerunTimer = useRef(null);

  useEffect(() => {
    writeJson(SEARCH_TUNING_KEY, { minScore, minSimilarity, maxResults });
  }, [minScore, minSimilarity, maxResults]);

  const resetSearchTuning = useCallback(() => {
    setMinScore(SEARCH_TUNING_DEFAULTS.minScore);
    setMinSimilarity(SEARCH_TUNING_DEFAULTS.minSimilarity);
    setMaxResults(SEARCH_TUNING_DEFAULTS.maxResults);
  }, []);

  const imageResults = useMemo(
    () => getImageResults(results),
    [results]
  );

  const visibleImageResults = useMemo(
    () => imageResults.slice(0, visibleResultsCount),
    [imageResults, visibleResultsCount]
  );


  const { sentinelRef, sentinelTerminalRef } = useProgressiveList({
    items: imageResults,
    visibleCount: visibleResultsCount,
    setVisibleCount: setVisibleResultsCount
  });

  const videoGroups = useMemo(
    () => groupVideoResults(results, expandedFramesByPath),
    [results, expandedFramesByPath]
  );

  const queryRef = searchInfo?.queryRef ?? null;
  const canExpandVideos = results.length > 0 && Boolean(queryRef || searchInfo?.query);

  // Forget everything tied to the current results (expansions, in-flight requests, query ref).
  const resetSearchState = () => {
    generation.current += 1;
    expandInFlight.current = new Set();
    searchInfoRef.current = null;
    setSearchInfo(null);
    setExpandedFramesByPath({});
    setExpandingVideoPath(null);
  };

  const applyResults = (data, info, seq) => {
    appliedSeq.current = seq;
    resetSearchState();
    const nextInfo = { ...info, queryRef: data.query_ref ?? null };
    searchInfoRef.current = nextInfo;
    setSearchInfo(nextInfo);
    setResults(annotateDuplicates(data.results));
  };

  const withCurrentFilters = (body) => (filtersRef.current ? { ...body, filters: filtersRef.current } : body);

  const cancelFilterRerun = useCallback(() => {
    if (filterRerunTimer.current) {
      clearTimeout(filterRerunTimer.current);
      filterRerunTimer.current = null;
    }
  }, []);

  // Start a search-type request: drops a pending filter re-run and makes older responses stale.
  // `sameSearch`: the request repeats the search behind the current results (a filter re-run), so
  // the view still matches searchInfoRef if it fails.
  const beginSearch = (sameSearch = false) => {
    cancelFilterRerun();
    searchSeq.current += 1;
    pendingSearch.current = { seq: searchSeq.current, filtersKey: filtersKeyRef.current, sameSearch };
    return searchSeq.current;
  };

  // Re-run the search behind the current results once the filter changes settle.
  const scheduleFilterRerun = useCallback(() => {
    cancelFilterRerun();
    filterRerunTimer.current = setTimeout(() => {
      filterRerunTimer.current = null;
      rerunForFiltersRef.current?.();
    }, FILTER_RERUN_DELAY_MS);
  }, [cancelFilterRerun]);

  // End of a request, in its finally block. Does nothing for a request a newer one overtook.
  // When the filters changed while this one was in flight, its results were produced with the old
  // filters: re-run it (through its own reference) with the new ones.
  const settleSearch = (seq) => {
    if (seq !== searchSeq.current) return;
    const pending = pendingSearch.current;
    pendingSearch.current = null;
    setIsSearching(false);
    if (pending && (appliedSeq.current === seq || pending.sameSearch) && pending.filtersKey !== filtersKeyRef.current && searchInfoRef.current) {
      scheduleFilterRerun();
    }
  };

  // Called when the results are cleared: nothing in flight may bring them back.
  const cancelPendingSearches = useCallback(() => {
    cancelFilterRerun();
    searchSeq.current += 1;
    pendingSearch.current = null;
    setIsSearching(false);
  }, [cancelFilterRerun]);

  // Posts a text search with the current filters. Returns false when a newer search made the
  // response stale and it was dropped.
  const postTextSearch = async (body, seq) => {
    const res = await postJson('/search', withCurrentFilters(body));
    const data = await res.json();
    if (seq !== searchSeq.current) return false;
    applyResults(data, { kind: 'text', topK: body.top_k, minScore: body.min_score, query: body.query }, seq);
    return true;
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      if (hasSearched && !imageSearchContext) {
        lastTextSearchBody.current = null;
        cancelPendingSearches();
        resetSearchState();
        setResults([]);
        setHasSearched(false);
        setQuery('');
      }
      return;
    }

    onSearchStart?.();
    const seq = beginSearch();
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(null);
    setVisibleResultsCount(80);
    const body = { query, top_k: parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults), min_score: parseFloat(minScore) };
    lastTextSearchBody.current = body;
    try {
      if (await postTextSearch(body, seq)) setShowSearchResults(true);
    } catch (err) {
      console.error(err);
    } finally {
      settleSearch(seq);
    }
  };

  const handleImageDrop = async (file) => {
    if (!file.type.startsWith('image/')) {
      setToast({ message: "Please drop an image file.", type: 'error' });
      return;
    }

    lastTextSearchBody.current = null;
    onSearchStart?.();
    const seq = beginSearch();
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(file.name);
    setVisibleResultsCount(80);
    setQuery('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (filtersRef.current) formData.append('filters', JSON.stringify(filtersRef.current));
      // We can also append top_k and min_score if the API takes them as form fields or query params
      // Our API takes them as query params in the new endpoint if we defined it that way
      const url = new URL(`${API_BASE}/search/image`);
      const topK = parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults);
      const imageMinScore = parseFloat(minSimilarity);
      url.searchParams.append('top_k', topK);
      url.searchParams.append('min_score', imageMinScore);

      const res = await apiFetch(url.toString(), {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (seq !== searchSeq.current) return;
      applyResults(data, { kind: 'image', topK, minScore: imageMinScore }, seq);
      setShowSearchResults(true);
      setToast({ message: `Found ${countSearchResults(data.results)} similar media result(s).`, type: 'success' });
    } catch (err) {
      console.error(err);
      if (seq === searchSeq.current) setToast({ message: "Failed to search by image.", type: 'error' });
    } finally {
      settleSearch(seq);
    }
  };

  const handleCloseSearchResults = useCallback(() => {
    lastTextSearchBody.current = null;
    cancelPendingSearches();
    resetSearchState();
    setShowSearchResults(false);
    setResults([]);
    setQuery('');
    setHasSearched(false);
    setImageSearchContext(null);
    onClose?.();
  }, [onClose, cancelPendingSearches]);

  const handleClearImageSearch = () => {
    lastTextSearchBody.current = null;
    cancelPendingSearches();
    resetSearchState();
    setImageSearchContext(null);
    setResults([]);
    setHasSearched(false);
  };

  const clearResults = () => {
    lastTextSearchBody.current = null;
    cancelPendingSearches();
    resetSearchState();
    setResults([]);
    setHasSearched(false);
    setImageSearchContext(null);
  };

  // Re-run the last search after the index changed, so stale hits disappear. Text searches
  // re-post the same request (with the current filters); image searches are re-run from the
  // backend's query_ref and are cleared when that has expired.
  const refreshSearch = async () => {
    const info = searchInfoRef.current;
    if (hasSearched && imageSearchContext && info?.kind === 'image' && info.queryRef) {
      const seq = beginSearch();
      setIsSearching(true);
      try {
        const res = await postJson('/search/ref', withCurrentFilters({ query_ref: info.queryRef, top_k: info.topK, min_score: info.minScore }));
        if (seq !== searchSeq.current) return;
        if (!res.ok) {
          clearResults();
          return;
        }
        const data = await res.json();
        if (seq !== searchSeq.current) return;
        applyResults(data, { kind: 'image', topK: info.topK, minScore: info.minScore }, seq);
      } catch (err) {
        console.error(err);
        if (seq === searchSeq.current) clearResults();
      } finally {
        settleSearch(seq);
      }
      return;
    }
    const body = lastTextSearchBody.current;
    if (imageSearchContext || !body || !hasSearched) {
      clearResults();
      return;
    }
    const seq = beginSearch();
    resetSearchState();
    setResults([]);
    setIsSearching(true);
    try {
      await postTextSearch(body, seq);
    } catch (err) {
      console.error(err);
    } finally {
      settleSearch(seq);
    }
  };

  // Re-run the search behind the current results with the current filters. Uses the saved query
  // reference (no re-embedding); a text search whose reference is gone is posted again by query.
  // Results are replaced only on success: a failure keeps the old ones and shows a toast.
  const rerunForFilters = async () => {
    const info = searchInfoRef.current;
    if (!info || !hasSearchedRef.current) return;
    const base = { kind: info.kind, topK: info.topK, minScore: info.minScore, query: info.query, queryRef: info.queryRef };
    if (base.kind === 'image' && !base.queryRef) {
      // The uploaded image is not kept, so without a reference the search cannot be repeated.
      clearResults();
      return;
    }

    const seq = beginSearch(true);
    setIsSearching(true);
    try {
      let res = null;
      if (base.queryRef) {
        res = await postJson('/search/ref', withCurrentFilters({ query_ref: base.queryRef, top_k: base.topK, min_score: base.minScore }));
        if (seq !== searchSeq.current) return;
        if (res.status === 410 && base.kind === 'image') {
          clearResults();
          return;
        }
      }
      if (!res || res.status === 410) {
        res = await postJson('/search', withCurrentFilters({ query: base.query, top_k: base.topK, min_score: base.minScore }));
        if (seq !== searchSeq.current) return;
      }
      if (!res.ok) {
        setToastRef.current({ message: 'Failed to apply the filters.', type: 'error' });
        return;
      }
      const data = await res.json();
      if (seq !== searchSeq.current) return;
      const nextInfo = { kind: base.kind, topK: base.topK, minScore: base.minScore };
      if (base.kind === 'text') nextInfo.query = base.query;
      applyResults(data, nextInfo, seq);
    } catch (err) {
      console.error(err);
      if (seq === searchSeq.current) setToastRef.current({ message: 'Failed to apply the filters.', type: 'error' });
    } finally {
      settleSearch(seq);
    }
  };
  rerunForFiltersRef.current = rerunForFilters;

  // When the filters change, re-run the current search once the changes settle. A search still in
  // flight is not touched: when it settles it sees that its filters are out of date (settleSearch).
  const appliedFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (appliedFiltersKey.current === filtersKey) return;
    appliedFiltersKey.current = filtersKey;
    cancelFilterRerun();
    if (pendingSearch.current) return;
    if (!hasSearchedRef.current || !searchInfoRef.current) return;
    scheduleFilterRerun();
  }, [filtersKey, cancelFilterRerun, scheduleFilterRerun]);

  // Re-run the search behind the current results (debounced like a filter change), for when the
  // data it depends on changed, e.g. a media details scan finished. Stable. Does nothing without a
  // search behind the view, and while a search is in flight (that one reads the newest data).
  const rerunCurrentSearch = useCallback(() => {
    if (pendingSearch.current || !hasSearchedRef.current || !searchInfoRef.current) return;
    scheduleFilterRerun();
  }, [scheduleFilterRerun]);

  // On unmount: stop the timer and drop any response still on its way.
  useEffect(() => () => {
    cancelFilterRerun();
    searchSeq.current += 1;
    pendingSearch.current = null;
  }, [cancelFilterRerun]);

  const resetSearch = () => {
    clearResults();
    setQuery('');
  };

  // Load every matching frame of one video ("Find more frames"). The search returns only a
  // handful of frames per video; this asks the backend for all frames above the search's minimum.
  const expandVideo = useCallback(async (path) => {
    const info = searchInfoRef.current;
    if (!info || !path) return;
    const flight = expandInFlight.current;
    if (flight.has(path)) return;
    flight.add(path);
    const startedGeneration = generation.current;
    setExpandingVideoPath(path);

    const body = { path, min_score: info.minScore };
    if (info.queryRef) body.query_ref = info.queryRef;
    if (info.kind === 'text') body.query = info.query;

    let failure = null;
    try {
      const res = await apiFetch(`${API_BASE}/search/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 410) {
        failure = 'This search has expired. Please search again.';
      } else if (!res.ok) {
        failure = 'Failed to load more frames.';
      } else {
        const data = await res.json();
        if (generation.current !== startedGeneration) return;
        if (!data.frames || data.frames.length === 0) {
          failure = 'This video is no longer available.';
        } else {
          setExpandedFramesByPath(prev => ({
            ...prev,
            [path]: { frames: data.frames, totalFrames: data.total_frames ?? null }
          }));
        }
      }
    } catch (err) {
      console.error(err);
      failure = 'Failed to load more frames.';
    } finally {
      flight.delete(path);
      if (generation.current === startedGeneration) {
        setExpandingVideoPath(prev => (prev === path ? null : prev));
      }
    }
    if (failure && generation.current === startedGeneration) {
      setToastRef.current({ message: failure, type: 'error' });
    }
  }, []);

  return {
    query,
    setQuery,
    results,
    isSearching,
    hasSearched,
    showSearchResults,
    minScore,
    setMinScore,
    minSimilarity,
    setMinSimilarity,
    maxResults,
    setMaxResults,
    resetSearchTuning,
    visibleResultsCount,
    setVisibleResultsCount,
    imageSearchContext,
    imageResults,
    visibleImageResults,
    videoGroups,
    queryRef,
    expandVideo,
    expandingVideoPath,
    canExpandVideos,
    sentinelRef,
    sentinelTerminalRef,
    handleSearch,
    handleImageDrop,
    handleCloseSearchResults,
    handleClearImageSearch,
    clearResults,
    refreshSearch,
    rerunCurrentSearch,
    resetSearch
  };
};
