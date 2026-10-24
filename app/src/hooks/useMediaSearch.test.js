import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaSearch } from './useMediaSearch';

const API = 'http://127.0.0.1:8000';

const imageHit = (path, extra = {}) => ({ path, media_type: 'image', score: 0.9, embedding: [1, 0], ...extra });
const videoHit = (path, ts, score) => ({ path, media_type: 'video', timestamp_seconds: ts, score });

const jsonResponse = (body) => ({ ok: true, json: async () => body });

const render = () => {
  const setToast = vi.fn();
  const onSearchStart = vi.fn();
  const onClose = vi.fn();
  const hook = renderHook(() => useMediaSearch({ setToast, onSearchStart, onClose }));
  return { ...hook, setToast, onSearchStart, onClose };
};

const submit = (result, query) => act(async () => {
  result.current.setQuery(query);
});

const runSearch = (result) => act(async () => {
  await result.current.handleSearch({ preventDefault: vi.fn() });
});

describe('useMediaSearch', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('handleSearch', () => {
    it('POSTs /search with the query, top_k and min_score, then annotates results', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        results: [imageHit('/a.jpg', { hash: 'h' }), imageHit('/b.jpg', { hash: 'h' }), videoHit('/v.mp4', 5, 0.7)],
      }));
      const { result, onSearchStart } = render();
      await submit(result, 'a cat');
      await runSearch(result);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API}/search`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ query: 'a cat', top_k: 50, min_score: 0.2 });

      expect(onSearchStart).toHaveBeenCalledTimes(1);
      expect(result.current.isSearching).toBe(false);
      expect(result.current.hasSearched).toBe(true);
      expect(result.current.showSearchResults).toBe(true);
      expect(result.current.imageSearchContext).toBeNull();
      expect(result.current.visibleResultsCount).toBe(80);

      expect(result.current.results).toHaveLength(3);
      result.current.results.forEach(r => expect(r).not.toHaveProperty('embedding'));
      expect(result.current.results[0]).toMatchObject({ duplicateType: 'exact', isDuplicate: true });
      expect(result.current.imageResults.map(r => r.path)).toEqual(['/a.jpg', '/b.jpg']);
      expect(result.current.visibleImageResults).toHaveLength(2);
      expect(result.current.videoGroups).toHaveLength(1);
      expect(result.current.videoGroups[0]).toMatchObject({ path: '/v.mp4', name: 'v.mp4', bestScore: 0.7 });
    });

    it('sends top_k 20000 when maxResults is 0 and uses the chosen min score', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
      const { result } = render();
      await submit(result, 'q');
      act(() => { result.current.setMaxResults(0); result.current.setMinScore(0.5); });
      await runSearch(result);

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ query: 'q', top_k: 20000, min_score: 0.5 });
    });

    it('resets the visible count to 80 on a new search', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
      const { result } = render();
      await submit(result, 'q');
      act(() => result.current.setVisibleResultsCount(240));
      expect(result.current.visibleResultsCount).toBe(240);
      await runSearch(result);
      expect(result.current.visibleResultsCount).toBe(80);
    });

    it('does nothing for an empty query before any search', async () => {
      const { result, onSearchStart } = render();
      await runSearch(result);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSearchStart).not.toHaveBeenCalled();
      expect(result.current.hasSearched).toBe(false);
    });

    it('clears results and hasSearched for an empty query after a previous search', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      await submit(result, 'q');
      await runSearch(result);
      expect(result.current.results).toHaveLength(1);

      await submit(result, '   ');
      await runSearch(result);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.query).toBe('');
    });

    it('does not clear an image search when the query is empty', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      const file = new File(['x'], 'cat.png', { type: 'image/png' });
      await act(async () => { await result.current.handleImageDrop(file); });

      await runSearch(result);
      expect(result.current.results).toHaveLength(1);
      expect(result.current.hasSearched).toBe(true);
    });

    it('ends with isSearching false when the request fails', async () => {
      fetchMock.mockRejectedValue(new Error('down'));
      const { result } = render();
      await submit(result, 'q');
      await runSearch(result);
      expect(result.current.isSearching).toBe(false);
      expect(result.current.hasSearched).toBe(true);
      expect(result.current.showSearchResults).toBe(false);
    });
  });

  describe('handleImageDrop', () => {
    it('rejects non-image files with an error toast and no fetch', async () => {
      const { result, setToast, onSearchStart } = render();
      await act(async () => {
        await result.current.handleImageDrop(new File(['x'], 'doc.txt', { type: 'text/plain' }));
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSearchStart).not.toHaveBeenCalled();
      expect(setToast).toHaveBeenCalledWith({ message: 'Please drop an image file.', type: 'error' });
    });

    it('POSTs the image to /search/image and records the context', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg'), imageHit('/b.jpg')] }));
      const { result, setToast, onSearchStart } = render();
      await submit(result, 'old query');
      const file = new File(['x'], 'cat.png', { type: 'image/png' });

      await act(async () => { await result.current.handleImageDrop(file); });

      const [url, init] = fetchMock.mock.calls[0];
      const parsed = new URL(url);
      expect(`${parsed.origin}${parsed.pathname}`).toBe(`${API}/search/image`);
      expect(parsed.searchParams.get('top_k')).toBe('50');
      expect(parsed.searchParams.get('min_score')).toBe('0.2');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get('file').name).toBe('cat.png');

      expect(onSearchStart).toHaveBeenCalledTimes(1);
      expect(result.current.imageSearchContext).toBe('cat.png');
      expect(result.current.query).toBe('');
      expect(result.current.hasSearched).toBe(true);
      expect(result.current.showSearchResults).toBe(true);
      expect(result.current.results).toHaveLength(2);
      result.current.results.forEach(r => expect(r).not.toHaveProperty('embedding'));
      expect(setToast).toHaveBeenCalledWith({ message: 'Found 2 similar media result(s).', type: 'success' });
      expect(result.current.isSearching).toBe(false);
    });

    it('reports a failure with an error toast', async () => {
      fetchMock.mockRejectedValue(new Error('down'));
      const { result, setToast } = render();
      await act(async () => {
        await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' }));
      });
      expect(setToast).toHaveBeenCalledWith({ message: 'Failed to search by image.', type: 'error' });
      expect(result.current.isSearching).toBe(false);
    });
  });

  describe('refreshSearch', () => {
    const refresh = (result) => act(async () => {
      await result.current.refreshSearch();
    });

    it('re-POSTs the original request body, replaces results and keeps the query and hasSearched', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg'), imageHit('/b.jpg', { embedding: [0, 1] })] }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      expect(result.current.results).toHaveLength(2);
      const originalBody = fetchMock.mock.calls[0][1].body;

      await submit(result, 'dogs');
      act(() => { result.current.setMinScore(0.6); result.current.setMaxResults(5); });

      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/b.jpg', { embedding: [0, 1] })] }));
      await refresh(result);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(`${API}/search`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(originalBody);
      expect(JSON.parse(init.body)).toEqual({ query: 'cats', top_k: 50, min_score: 0.2 });

      expect(result.current.results.map(r => r.path)).toEqual(['/b.jpg']);
      result.current.results.forEach(r => expect(r).not.toHaveProperty('embedding'));
      expect(result.current.hasSearched).toBe(true);
      expect(result.current.query).toBe('dogs');
      expect(result.current.showSearchResults).toBe(true);
      expect(result.current.isSearching).toBe(false);
    });

    it('does not call onSearchStart or reset the visible count', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result, onSearchStart } = render();
      await submit(result, 'cats');
      await runSearch(result);
      act(() => result.current.setVisibleResultsCount(240));
      expect(onSearchStart).toHaveBeenCalledTimes(1);

      await refresh(result);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onSearchStart).toHaveBeenCalledTimes(1);
      expect(result.current.visibleResultsCount).toBe(240);
    });

    it('clears results and the image context without fetching after an image search', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      await act(async () => {
        await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' }));
      });
      expect(result.current.imageSearchContext).toBe('cat.png');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await refresh(result);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current.results).toEqual([]);
      expect(result.current.imageSearchContext).toBeNull();
      expect(result.current.hasSearched).toBe(false);
    });

    it('does nothing but leave the results empty when no search has run', async () => {
      const { result } = render();
      await refresh(result);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.isSearching).toBe(false);
    });

    it('does not re-run a search that was reset', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      act(() => result.current.handleCloseSearchResults());
      await refresh(result);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.results).toEqual([]);
    });

    it('leaves results empty, hasSearched true and isSearching false when the re-search fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);

      fetchMock.mockRejectedValueOnce(new Error('down'));
      await refresh(result);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalled();
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(true);
      expect(result.current.isSearching).toBe(false);
    });
  });

  describe('resets', () => {
    const withResults = async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const hook = render();
      await submit(hook.result, 'cats');
      await runSearch(hook.result);
      expect(hook.result.current.results).toHaveLength(1);
      return hook;
    };

    it('handleCloseSearchResults resets everything and calls onClose', async () => {
      const { result, onClose } = await withResults();
      act(() => result.current.handleCloseSearchResults());
      expect(result.current.showSearchResults).toBe(false);
      expect(result.current.results).toEqual([]);
      expect(result.current.query).toBe('');
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.imageSearchContext).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clearResults keeps the query', async () => {
      const { result } = await withResults();
      act(() => result.current.clearResults());
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.imageSearchContext).toBeNull();
      expect(result.current.query).toBe('cats');
    });

    it('resetSearch also clears the query', async () => {
      const { result } = await withResults();
      act(() => result.current.resetSearch());
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(false);
      expect(result.current.query).toBe('');
    });

    it('handleClearImageSearch clears the image context, results and hasSearched', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')] }));
      const { result } = render();
      await act(async () => {
        await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' }));
      });
      expect(result.current.imageSearchContext).toBe('cat.png');

      act(() => result.current.handleClearImageSearch());
      expect(result.current.imageSearchContext).toBeNull();
      expect(result.current.results).toEqual([]);
      expect(result.current.hasSearched).toBe(false);
    });
  });
});
