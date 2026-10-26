import { useState, useMemo, useRef, useCallback } from 'react';
import { API_BASE } from '../config';
import { annotateDuplicates, groupVideoResults, getImageResults, countSearchResults } from '../utils/searchResults';
import { useProgressiveList } from './useProgressiveList';
import { apiFetch } from '../utils/api';

export const useMediaSearch = ({ setToast, onSearchStart, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [minScore, setMinScore] = useState(0.10);
  const [minSimilarity, setMinSimilarity] = useState(0.70);
  const [maxResults, setMaxResults] = useState(50);
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

  const applyResults = (data, info) => {
    resetSearchState();
    const nextInfo = { ...info, queryRef: data.query_ref ?? null };
    searchInfoRef.current = nextInfo;
    setSearchInfo(nextInfo);
    setResults(annotateDuplicates(data.results));
  };

  const postTextSearch = async (body) => {
    const res = await apiFetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    applyResults(data, { kind: 'text', topK: body.top_k, minScore: body.min_score, query: body.query });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      if (hasSearched && !imageSearchContext) {
        lastTextSearchBody.current = null;
        resetSearchState();
        setResults([]);
        setHasSearched(false);
        setQuery('');
      }
      return;
    }

    onSearchStart?.();
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(null);
    setVisibleResultsCount(80);
    const body = { query, top_k: parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults), min_score: parseFloat(minScore) };
    lastTextSearchBody.current = body;
    try {
      await postTextSearch(body);
      setShowSearchResults(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleImageDrop = async (file) => {
    if (!file.type.startsWith('image/')) {
      setToast({ message: "Please drop an image file.", type: 'error' });
      return;
    }

    lastTextSearchBody.current = null;
    onSearchStart?.();
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(file.name);
    setVisibleResultsCount(80);
    setQuery('');

    try {
      const formData = new FormData();
      formData.append('file', file);
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
      applyResults(data, { kind: 'image', topK, minScore: imageMinScore });
      setShowSearchResults(true);
      setToast({ message: `Found ${countSearchResults(data.results)} similar media result(s).`, type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to search by image.", type: 'error' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCloseSearchResults = useCallback(() => {
    lastTextSearchBody.current = null;
    resetSearchState();
    setShowSearchResults(false);
    setResults([]);
    setQuery('');
    setHasSearched(false);
    setImageSearchContext(null);
    onClose?.();
  }, [onClose]);

  const handleClearImageSearch = () => {
    lastTextSearchBody.current = null;
    resetSearchState();
    setImageSearchContext(null);
    setResults([]);
    setHasSearched(false);
  };

  const clearResults = () => {
    lastTextSearchBody.current = null;
    resetSearchState();
    setResults([]);
    setHasSearched(false);
    setImageSearchContext(null);
  };

  // Re-run the last search after the index changed, so stale hits disappear. Text searches
  // re-post the same request body; image searches are re-run from the backend's query_ref and are
  // cleared when that has expired.
  const refreshSearch = async () => {
    const info = searchInfoRef.current;
    if (hasSearched && imageSearchContext && info?.kind === 'image' && info.queryRef) {
      setIsSearching(true);
      try {
        const res = await apiFetch(`${API_BASE}/search/ref`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_ref: info.queryRef, top_k: info.topK, min_score: info.minScore })
        });
        if (!res.ok) {
          clearResults();
          return;
        }
        const data = await res.json();
        applyResults(data, { kind: 'image', topK: info.topK, minScore: info.minScore });
      } catch (err) {
        console.error(err);
        clearResults();
      } finally {
        setIsSearching(false);
      }
      return;
    }
    const body = lastTextSearchBody.current;
    if (imageSearchContext || !body || !hasSearched) {
      clearResults();
      return;
    }
    resetSearchState();
    setResults([]);
    setIsSearching(true);
    try {
      await postTextSearch(body);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

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
    resetSearch
  };
};
