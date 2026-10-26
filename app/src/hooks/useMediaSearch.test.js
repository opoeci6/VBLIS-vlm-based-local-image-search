import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaSearch } from './useMediaSearch';

const API = 'http://127.0.0.1:8000';

const imageHit = (path, extra = {}) => ({ path, media_type: 'image', score: 0.9, embedding: [1, 0], ...extra });
const videoHit = (path, ts, score) => ({ path, media_type: 'video', timestamp_seconds: ts, score });

const jsonResponse = (body) => ({ ok: true, json: async () => body });
const errorResponse = (status) => ({ ok: false, status, json: async () => ({ detail: 'nope' }) });

// A fetch response the test resolves by hand, to hold a request in flight.
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

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
      expect(JSON.parse(init.body)).toEqual({ query: 'a cat', top_k: 50, min_score: 0.1 });

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

    it('sends minSimilarity (not minScore) as min_score for image search', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
      const { result } = render();
      expect(result.current.minSimilarity).toBe(0.7);
      act(() => { result.current.setMinSimilarity(0.55); result.current.setMinScore(0.3); });

      await act(async () => { await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' })); });

      const parsed = new URL(fetchMock.mock.calls[0][0]);
      expect(parsed.searchParams.get('min_score')).toBe('0.55');
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
      expect(parsed.searchParams.get('min_score')).toBe('0.7');
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

    it('counts each video once in the found-results toast', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        results: [imageHit('/a.jpg'), videoHit('/v.mp4', 1, 0.8), videoHit('/v.mp4', 2, 0.7), videoHit('/v.mp4', 3, 0.6)],
      }));
      const { result, setToast } = render();
      await act(async () => { await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' })); });
      expect(setToast).toHaveBeenCalledWith({ message: 'Found 2 similar media result(s).', type: 'success' });
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
      expect(JSON.parse(init.body)).toEqual({ query: 'cats', top_k: 50, min_score: 0.1 });

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

    describe('image search with a query_ref', () => {
      const dropImage = async (result, payload = { results: [imageHit('/a.jpg')], query_ref: 'img-ref' }) => {
        fetchMock.mockResolvedValueOnce(jsonResponse(payload));
        await act(async () => {
          await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' }));
        });
      };

      it('re-runs the search through /search/ref with the original top_k and min score', async () => {
        const { result } = render();
        act(() => { result.current.setMinSimilarity(0.55); result.current.setMaxResults(25); });
        await dropImage(result);
        act(() => { result.current.setMinSimilarity(0.9); result.current.setMaxResults(100); });

        fetchMock.mockResolvedValueOnce(jsonResponse({
          results: [imageHit('/b.jpg', { embedding: [0, 1] })],
          query_ref: 'img-ref-2',
        }));
        await refresh(result);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe(`${API}/search/ref`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ query_ref: 'img-ref', top_k: 25, min_score: 0.55 });

        expect(result.current.results.map(r => r.path)).toEqual(['/b.jpg']);
        result.current.results.forEach(r => expect(r).not.toHaveProperty('embedding'));
        expect(result.current.queryRef).toBe('img-ref-2');
        expect(result.current.imageSearchContext).toBe('cat.png');
        expect(result.current.hasSearched).toBe(true);
        expect(result.current.isSearching).toBe(false);
      });

      it('keeps working across repeated refreshes', async () => {
        const { result } = render();
        await dropImage(result);
        fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/b.jpg')], query_ref: 'img-ref-2' }));
        await refresh(result);
        fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/c.jpg')], query_ref: 'img-ref-3' }));
        await refresh(result);

        expect(JSON.parse(fetchMock.mock.calls[2][1].body).query_ref).toBe('img-ref-2');
        expect(result.current.results.map(r => r.path)).toEqual(['/c.jpg']);
      });

      it('clears the results on HTTP 410', async () => {
        const { result } = render();
        await dropImage(result);

        fetchMock.mockResolvedValueOnce(errorResponse(410));
        await refresh(result);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.current.results).toEqual([]);
        expect(result.current.imageSearchContext).toBeNull();
        expect(result.current.hasSearched).toBe(false);
        expect(result.current.queryRef).toBeNull();
        expect(result.current.isSearching).toBe(false);
      });

      it('clears the results when the request fails', async () => {
        const { result } = render();
        await dropImage(result);

        fetchMock.mockRejectedValueOnce(new Error('down'));
        await refresh(result);

        expect(result.current.results).toEqual([]);
        expect(result.current.imageSearchContext).toBeNull();
        expect(result.current.hasSearched).toBe(false);
        expect(result.current.isSearching).toBe(false);
      });

      it('clears the results without fetching when the backend returned no query_ref', async () => {
        const { result } = render();
        await dropImage(result, { results: [imageHit('/a.jpg')] });

        await refresh(result);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current.results).toEqual([]);
        expect(result.current.imageSearchContext).toBeNull();
      });
    });

    it('re-posts a text search with the original min score, not the slider value', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg')], query_ref: 'ref-1' }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      act(() => result.current.setMinScore(0.8));

      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg')], query_ref: 'ref-2' }));
      await refresh(result);

      expect(fetchMock.mock.calls[1][0]).toBe(`${API}/search`);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ query: 'cats', top_k: 50, min_score: 0.1 });
      expect(result.current.queryRef).toBe('ref-2');
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

  describe('query_ref', () => {
    it('stores query_ref from a text search and reports null when absent', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg')], query_ref: 'ref-1' }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      expect(result.current.queryRef).toBe('ref-1');

      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [imageHit('/a.jpg')] }));
      await runSearch(result);
      expect(result.current.queryRef).toBeNull();
    });

    it('stores query_ref from an image search', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')], query_ref: 'img-ref' }));
      const { result } = render();
      await act(async () => { await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' })); });
      expect(result.current.queryRef).toBe('img-ref');
    });

    it.each([
      ['handleCloseSearchResults', (r) => r.handleCloseSearchResults()],
      ['clearResults', (r) => r.clearResults()],
      ['resetSearch', (r) => r.resetSearch()],
      ['handleClearImageSearch', (r) => r.handleClearImageSearch()],
    ])('is cleared by %s', async (_name, clear) => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [imageHit('/a.jpg')], query_ref: 'ref-1' }));
      const { result } = render();
      await submit(result, 'cats');
      await runSearch(result);
      expect(result.current.queryRef).toBe('ref-1');
      expect(result.current.canExpandVideos).toBe(true);

      act(() => clear(result.current));
      expect(result.current.queryRef).toBeNull();
      expect(result.current.canExpandVideos).toBe(false);
    });
  });

  describe('expandVideo', () => {
    const frames = (path, count, scoreBase = 0.5) => Array.from({ length: count }, (_, i) => (
      { ...videoHit(path, 100 + i, scoreBase - i * 0.01), id: `${path}#${i}`, embedding: null }
    ));

    const expand = (result, path = '/v.mp4') => act(async () => {
      await result.current.expandVideo(path);
    });

    const searchWithVideo = async ({ queryRef = 'ref-1', extra = {} } = {}) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        results: [imageHit('/a.jpg'), { ...videoHit('/v.mp4', 5, 0.7), id: 'shown' }, { ...videoHit('/w.mp4', 9, 0.4), id: 'w1' }],
        query_ref: queryRef,
        ...extra,
      }));
      const hook = render();
      await submit(hook.result, 'cats');
      await runSearch(hook.result);
      return hook;
    };

    it('POSTs /search/video with the ref, path, the search min_score and the query for text searches', async () => {
      const { result } = await searchWithVideo();
      // The slider moves after the search: expansion must keep using the search's minimum.
      act(() => result.current.setMinScore(0.9));
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 3), total_frames: 3, query_ref: 'ref-1' }));

      await expand(result);

      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(`${API}/search/video`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ query_ref: 'ref-1', path: '/v.mp4', min_score: 0.1, query: 'cats' });
    });

    it('omits query_ref when the backend gave none and still sends the query', async () => {
      const { result } = await searchWithVideo({ queryRef: null });
      expect(result.current.canExpandVideos).toBe(true);
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 2), total_frames: 2 }));
      await expand(result);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ path: '/v.mp4', min_score: 0.1, query: 'cats' });
    });

    it('sends the ref and the image search minimum, but no query, after an image search', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ ...videoHit('/v.mp4', 5, 0.8), id: 'shown' }], query_ref: 'img-ref' }));
      const { result } = render();
      act(() => result.current.setMinSimilarity(0.55));
      await act(async () => { await result.current.handleImageDrop(new File(['x'], 'cat.png', { type: 'image/png' })); });
      act(() => result.current.setMinSimilarity(0.9));

      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 2), total_frames: 2, query_ref: 'img-ref' }));
      await expand(result);

      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ query_ref: 'img-ref', path: '/v.mp4', min_score: 0.55 });
    });

    it('merges the loaded frames into the video group without reordering the groups', async () => {
      const { result, setToast } = await searchWithVideo();
      expect(result.current.videoGroups.map(g => g.path)).toEqual(['/v.mp4', '/w.mp4']);
      expect(result.current.videoGroups[0]).toMatchObject({ isExpanded: false, totalFrames: null });
      const loaded = [
        { ...videoHit('/v.mp4', 5, 0.7), id: 'shown', embedding: null },
        ...frames('/v.mp4', 3, 0.6),
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: loaded, total_frames: 4 }));

      await expand(result);

      const [group, other] = result.current.videoGroups;
      expect(group.path).toBe('/v.mp4');
      expect(group.frames).toHaveLength(4);
      expect(group).toMatchObject({ isExpanded: true, totalFrames: 4 });
      expect(other).toMatchObject({ path: '/w.mp4', isExpanded: false });
      expect(result.current.expandingVideoPath).toBeNull();
      expect(setToast).not.toHaveBeenCalled();
    });

    it('tracks the video being loaded while the request is in flight', async () => {
      const { result } = await searchWithVideo();
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);

      let call;
      act(() => { call = result.current.expandVideo('/v.mp4'); });
      expect(result.current.expandingVideoPath).toBe('/v.mp4');

      await act(async () => {
        pending.resolve(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 2), total_frames: 2 }));
        await call;
      });
      expect(result.current.expandingVideoPath).toBeNull();
    });

    it('ignores a second call for the same path while one is in flight', async () => {
      const { result } = await searchWithVideo();
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);

      let first;
      act(() => { first = result.current.expandVideo('/v.mp4'); });
      await expand(result);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        pending.resolve(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 2), total_frames: 2 }));
        await first;
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('allows another call once the previous one has finished', async () => {
      const { result } = await searchWithVideo();
      fetchMock.mockResolvedValueOnce(errorResponse(500));
      await expand(result);
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 2), total_frames: 2 }));
      await expand(result);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.current.videoGroups[0].isExpanded).toBe(true);
    });

    it('keeps expandVideo stable across renders', async () => {
      const { result } = await searchWithVideo();
      const handler = result.current.expandVideo;
      act(() => result.current.setQuery('typing'));
      act(() => result.current.setMinScore(0.4));
      expect(result.current.expandVideo).toBe(handler);
    });

    it('toasts and keeps the group unexpanded on HTTP 410', async () => {
      const { result, setToast } = await searchWithVideo();
      fetchMock.mockResolvedValueOnce(errorResponse(410));
      await expand(result);
      expect(setToast).toHaveBeenCalledWith({ message: 'This search has expired. Please search again.', type: 'error' });
      expect(result.current.videoGroups[0].isExpanded).toBe(false);
      expect(result.current.expandingVideoPath).toBeNull();
    });

    it('toasts when the video has no frames left', async () => {
      const { result, setToast } = await searchWithVideo();
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: [], total_frames: 0, query_ref: 'ref-1' }));
      await expand(result);
      expect(setToast).toHaveBeenCalledWith({ message: 'This video is no longer available.', type: 'error' });
      expect(result.current.videoGroups[0].isExpanded).toBe(false);
    });

    it('toasts a generic failure on another HTTP error', async () => {
      const { result, setToast } = await searchWithVideo();
      fetchMock.mockResolvedValueOnce(errorResponse(500));
      await expand(result);
      expect(setToast).toHaveBeenCalledWith({ message: 'Failed to load more frames.', type: 'error' });
      expect(result.current.expandingVideoPath).toBeNull();
    });

    it('toasts a generic failure when the request throws', async () => {
      const { result, setToast } = await searchWithVideo();
      fetchMock.mockRejectedValueOnce(new Error('down'));
      await expand(result);
      expect(setToast).toHaveBeenCalledWith({ message: 'Failed to load more frames.', type: 'error' });
      expect(result.current.expandingVideoPath).toBeNull();
    });

    it('drops a response that arrives after a new search replaced the results', async () => {
      const { result, setToast } = await searchWithVideo();
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);
      let call;
      act(() => { call = result.current.expandVideo('/v.mp4'); });

      fetchMock.mockResolvedValueOnce(jsonResponse({
        results: [{ ...videoHit('/v.mp4', 8, 0.65), id: 'new-shown' }],
        query_ref: 'ref-2',
      }));
      await runSearch(result);
      expect(result.current.expandingVideoPath).toBeNull();

      await act(async () => {
        pending.resolve(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 5), total_frames: 5 }));
        await call;
      });

      expect(result.current.videoGroups).toHaveLength(1);
      expect(result.current.videoGroups[0].frames.map(f => f.id)).toEqual(['new-shown']);
      expect(result.current.videoGroups[0].isExpanded).toBe(false);
      expect(setToast).not.toHaveBeenCalled();
    });

    it('drops a late error toast after the results were closed', async () => {
      const { result, setToast } = await searchWithVideo();
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);
      let call;
      act(() => { call = result.current.expandVideo('/v.mp4'); });
      act(() => result.current.handleCloseSearchResults());

      await act(async () => {
        pending.resolve(errorResponse(410));
        await call;
      });
      expect(setToast).not.toHaveBeenCalled();
    });

    it('lets the same path be expanded again after a new search while an old request is pending', async () => {
      const { result } = await searchWithVideo();
      const pending = deferred();
      fetchMock.mockReturnValueOnce(pending.promise);
      act(() => { result.current.expandVideo('/v.mp4'); });

      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ ...videoHit('/v.mp4', 8, 0.65), id: 'n1' }], query_ref: 'ref-2' }));
      await runSearch(result);

      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 3), total_frames: 3 }));
      await expand(result);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result.current.videoGroups[0]).toMatchObject({ isExpanded: true, totalFrames: 3 });
    });

    it('forgets expansions when the results are replaced', async () => {
      const { result } = await searchWithVideo();
      fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/v.mp4', frames: frames('/v.mp4', 3), total_frames: 3 }));
      await expand(result);
      expect(result.current.videoGroups[0].isExpanded).toBe(true);

      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ ...videoHit('/v.mp4', 5, 0.7), id: 'shown' }], query_ref: 'ref-2' }));
      await act(async () => { await result.current.refreshSearch(); });
      expect(result.current.videoGroups[0].isExpanded).toBe(false);
    });

    it('does nothing without a search', async () => {
      const { result } = render();
      await expand(result);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.canExpandVideos).toBe(false);
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

  describe('handler identity', () => {
    it('keeps handleCloseSearchResults stable across re-renders when onClose is stable', () => {
      const setToast = vi.fn();
      const onClose = vi.fn();
      const { result, rerender } = renderHook(() => useMediaSearch({ setToast, onSearchStart: vi.fn(), onClose }));
      const handler = result.current.handleCloseSearchResults;
      rerender();
      act(() => result.current.setQuery('typing'));
      expect(result.current.handleCloseSearchResults).toBe(handler);
    });
  });
});
