import { memo } from 'react';
import { Search, FolderOpen, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { VideoResultFolder } from './VideoResultFolder';
import { SearchResultCard } from './SearchResultCard';

export const TerminalResultsModal = memo(function TerminalResultsModal({ showSearchResults, results, uiTheme, handleCloseSearchResults, imageSearchContext, query, videoGroups, imageResults, visibleImageResults, visibleResultsCount, setVisibleResultsCount, sentinelTerminalRef, setSelectedVideoGroup, setSelectedImage }) {
  if (!(showSearchResults && results.length > 0 && uiTheme === 'terminal')) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-6 animate-in fade-in duration-200"
      onClick={handleCloseSearchResults}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-7xl flex-col border border-white bg-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-white p-5">
          <Search className="w-6 h-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Search Results</h2>
            <p className="mt-1 truncate text-sm">
              {imageSearchContext ? `IMAGE: ${imageSearchContext}` : `QUERY: ${query}`}
            </p>
          </div>
          <span className="border border-white px-3 py-2 text-sm font-bold">
            {results.length} MATCH{results.length === 1 ? '' : 'ES'}
          </span>
          <button
            onClick={handleCloseSearchResults}
            className="icon-tile flex h-12 w-12 flex-shrink-0 items-center justify-center border border-white"
            aria-label="Close search results"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="custom-scrollbar overflow-y-auto p-6">
          {videoGroups.length > 0 && (
            <section className={imageResults.length > 0 ? 'mb-10' : ''}>
              <div className="mb-4 flex items-center gap-3 border-b border-white pb-3">
                <FolderOpen className="w-5 h-5" />
                <h3 className="text-lg font-bold">Video Results</h3>
                <span className="border border-white px-2 py-0.5 text-xs font-bold">{videoGroups.length}</span>
                <span className="ml-auto text-xs">SORTED BY BEST MATCH</span>
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
                  <h3 className="text-lg font-bold">Image Results</h3>
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
