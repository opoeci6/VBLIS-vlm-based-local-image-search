import { FolderOpen, Loader2, Image as ImageIcon } from 'lucide-react';
import { VideoResultFolder } from './VideoResultFolder';
import { SearchResultCard } from './SearchResultCard';

export const SearchResultsGrid = ({ results, uiTheme, videoGroups, imageResults, visibleImageResults, visibleResultsCount, setVisibleResultsCount, sentinelRef, setSelectedVideoGroup, setSelectedImage }) => {
  if (!(results.length > 0 && uiTheme === 'modern')) return null;

  return (
    <div className="w-full max-w-7xl animate-in fade-in duration-300 mt-2">
      {/* Video Matches */}
      {videoGroups.length > 0 && (
        <section className={imageResults.length > 0 ? 'mb-10' : ''}>
          <div className="mb-4 flex items-center gap-2.5 text-neutral-800 dark:text-neutral-200 border-b border-gray-100 dark:border-neutral-800 pb-3">
            <FolderOpen className="w-5 h-5 text-indigo-500" />
            <h3 className="text-lg font-bold">Video Results</h3>
            <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-bold border border-indigo-100 dark:border-indigo-500/20">
              {videoGroups.length}
            </span>
            <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500 font-medium">Sorted by best match</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

      {/* Image Matches */}
      {imageResults.length > 0 && (
        <section>
          {videoGroups.length > 0 && (
            <div className="mb-4 flex items-center gap-2.5 text-neutral-800 dark:text-neutral-200 border-b border-gray-100 dark:border-neutral-800 pb-3">
              <ImageIcon className="w-5 h-5 text-indigo-500" />
              <h3 className="text-lg font-bold">Image Results</h3>
              <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-bold border border-indigo-100 dark:border-indigo-500/20">
                {imageResults.length}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
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
            <div ref={sentinelRef} className="mt-8 mb-4 flex flex-col items-center justify-center gap-2 py-4">
              <button
                type="button"
                onClick={() => setVisibleResultsCount(prev => Math.min(prev + 80, imageResults.length))}
                className="px-6 py-2.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-2xl border border-indigo-200 dark:border-indigo-500/30 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center gap-2"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading more results ({visibleResultsCount} of {imageResults.length})</span>
              </button>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono">
                Showing {visibleResultsCount} of {imageResults.length} matches
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
