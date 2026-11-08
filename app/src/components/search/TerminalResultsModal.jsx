import { memo } from 'react';
import { Search, FolderOpen, Library, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { VideoResultFolder } from './VideoResultFolder';
import { SearchResultCard } from './SearchResultCard';
import { BrowseSortToggle } from './BrowseSortToggle';
import { BrowseHint } from './BrowseHint';
import { ActiveFilterChips } from './filters/ActiveFilterChips';
import { SearchFiltersButton } from './filters/SearchFiltersButton';

export const TerminalResultsModal = memo(function TerminalResultsModal({ showSearchResults, results, uiTheme, handleCloseSearchResults, imageSearchContext, query, videoGroups, imageResults, visibleImageResults, visibleResultsCount, setVisibleResultsCount, sentinelTerminalRef, setSelectedVideoGroup, setSelectedImage, filterChips, onClearFilters, activeFilterCount = 0, filtersOpen = false, onToggleFilters, isBrowsing = false, browseSort = 'newest', onBrowseSortChange, browseTotal = null, showBrowseHint = false, onDismissBrowseHint }) {
  const backdropDismiss = useBackdropDismiss(handleCloseSearchResults);

  if (!(showSearchResults && results.length > 0 && uiTheme === 'terminal')) return null;

  // Counted like Max Results: every image once, every video once (not its frames).
  const matchCount = imageResults.length + videoGroups.length;
  const itemCount = browseTotal ?? matchCount;
  const sortWords = browseSort === 'oldest' ? 'OLDEST FIRST' : 'NEWEST FIRST';
  const HeaderIcon = isBrowsing ? Library : Search;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-6 animate-in fade-in duration-200"
      {...backdropDismiss}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-7xl flex-col border border-white bg-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-white p-5">
          <HeaderIcon className="w-6 h-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{isBrowsing ? 'Library' : 'Search Results'}</h2>
            <p className="mt-1 truncate text-sm">
              {isBrowsing ? `BROWSING · ${sortWords}` : imageSearchContext ? `IMAGE: ${imageSearchContext}` : `QUERY: ${query}`}
            </p>
          </div>
          <span className="border border-white px-3 py-2 text-sm font-bold">
            {isBrowsing ? `${itemCount} ITEM${itemCount === 1 ? '' : 'S'}` : `${matchCount} MATCH${matchCount === 1 ? '' : 'ES'}`}
          </span>
          {isBrowsing && <BrowseSortToggle sort={browseSort} onChange={onBrowseSortChange} variant="terminal" />}
          <SearchFiltersButton activeCount={activeFilterCount} isOpen={filtersOpen} onToggle={onToggleFilters} />
          <button
            onClick={handleCloseSearchResults}
            className="icon-tile flex h-12 w-12 flex-shrink-0 items-center justify-center border border-white"
            aria-label="Close search results"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isBrowsing && showBrowseHint && (
          <div className="border-b border-white px-5 py-3">
            <BrowseHint onDismiss={onDismissBrowseHint} />
          </div>
        )}

        <ActiveFilterChips chips={filterChips} onClearAll={onClearFilters} className="border-b border-white px-5 py-3" />

        <div className="custom-scrollbar overflow-y-auto p-6">
          {videoGroups.length > 0 && (
            <section className={imageResults.length > 0 ? 'mb-10' : ''}>
              <div className="mb-4 flex items-center gap-3 border-b border-white pb-3">
                <FolderOpen className="w-5 h-5" />
                <h3 className="text-lg font-bold">{isBrowsing ? 'Videos' : 'Video Results'}</h3>
                <span className="border border-white px-2 py-0.5 text-xs font-bold">{videoGroups.length}</span>
                <span className="ml-auto text-xs">{isBrowsing ? sortWords : 'SORTED BY BEST MATCH'}</span>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {videoGroups.map((group, idx) => (
                  <VideoResultFolder
                    key={group.path}
                    group={group}
                    idx={idx}
                    onSelect={setSelectedVideoGroup}
                    uiTheme={uiTheme}
                  />
                ))}
              </div>
            </section>
          )}

          {imageResults.length > 0 && (
            <section>
              {videoGroups.length > 0 && (
                <div className="mb-4 flex items-center gap-3 border-b border-white pb-3">
                  <ImageIcon className="w-5 h-5" />
                  <h3 className="text-lg font-bold">{isBrowsing ? 'Images' : 'Image Results'}</h3>
                  <span className="border border-white px-2 py-0.5 text-xs font-bold">{imageResults.length}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {visibleImageResults.map((res, idx) => (
                  <SearchResultCard
                    key={res.id || res.path}
                    res={res}
                    idx={idx}
                    onSelect={setSelectedImage}
                    uiTheme={uiTheme}
                  />
                ))}
              </div>

              {imageResults.length > visibleResultsCount && (
                <div ref={sentinelTerminalRef} className="mt-8 mb-4 flex flex-col items-center justify-center gap-2 py-4">
                  <button
                    type="button"
                    onClick={() => setVisibleResultsCount(prev => Math.min(prev + 80, imageResults.length))}
                    className="px-6 py-2.5 bg-black border border-white text-white hover:bg-white hover:text-black font-bold text-xs transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>LOAD MORE ({visibleResultsCount} OF {imageResults.length})</span>
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
});
