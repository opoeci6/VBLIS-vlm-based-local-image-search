import { useState, useMemo, useRef, useCallback } from 'react';
import { API_BASE } from '../config';
import { annotateDuplicates, groupVideoResults, getImageResults } from '../utils/searchResults';
import { useProgressiveList } from './useProgressiveList';

export const useMediaSearch = ({ setToast, onSearchStart, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [minScore, setMinScore] = useState(0.20);
  const [maxResults, setMaxResults] = useState(50);
  const [visibleResultsCount, setVisibleResultsCount] = useState(80);
  const [imageSearchContext, setImageSearchContext] = useState(null);
  // Request body of the last submitted text search, so it can be re-run after the index changes.
  const lastTextSearchBody = useRef(null);

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

  const videoGroups = useMemo(() => groupVideoResults(results), [results]);

  const postTextSearch = async (body) => {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    setResults(annotateDuplicates(data.results));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      if (hasSearched && !imageSearchContext) {
        lastTextSearchBody.current = null;
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
      url.searchParams.append('top_k', parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults));
      url.searchParams.append('min_score', parseFloat(minScore));

      const res = await fetch(url.toString(), {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      setResults(annotateDuplicates(data.results));
      setShowSearchResults(true);
      setToast({ message: `Found ${data.results?.length || 0} similar media result(s).`, type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to search by image.", type: 'error' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCloseSearchResults = useCallback(() => {
    lastTextSearchBody.current = null;
    setShowSearchResults(false);
    setResults([]);
    setQuery('');
    setHasSearched(false);
    setImageSearchContext(null);
    onClose?.();
  }, [onClose]);

  const handleClearImageSearch = () => {
    lastTextSearchBody.current = null;
    setImageSearchContext(null);
    setResults([]);
    setHasSearched(false);
  };

  const clearResults = () => {
    lastTextSearchBody.current = null;
    setResults([]);
    setHasSearched(false);
    setImageSearchContext(null);
  };

  // Re-run the last text search (same request body) after the index changed, so stale hits
  // disappear. Image searches cannot be re-run and are cleared instead.
  const refreshSearch = async () => {
    const body = lastTextSearchBody.current;
    if (imageSearchContext || !body || !hasSearched) {
      clearResults();
      return;
    }
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

  return {
    query,
    setQuery,
    results,
    isSearching,
    hasSearched,
    showSearchResults,
    minScore,
    setMinScore,
    maxResults,
    setMaxResults,
    visibleResultsCount,
    setVisibleResultsCount,
    imageSearchContext,
    imageResults,
    visibleImageResults,
    videoGroups,
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
