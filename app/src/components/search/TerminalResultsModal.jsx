import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FolderOpen, Library, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { VideoResultFolder } from './VideoResultFolder';
import { SearchResultCard } from './SearchResultCard';
import { BrowseSortToggle } from './BrowseSortToggle';
import { BrowseHint } from './BrowseHint';
import { ActiveFilterChips } from './filters/ActiveFilterChips';
import { SearchFiltersButton } from './filters/SearchFiltersButton';

export const TerminalResultsModal = memo(function TerminalResultsModal({ showSearchResults, results, uiTheme, handleCloseSearchResults, imageSearchContext, query, videoGroups, imageResults, visibleImageResults, visibleResultsCount, setVisibleResultsCount, sentinelTerminalRef, setSelectedVideoGroup, setSelectedImage, filterChips, onClearFilters, activeFilterCount = 0, filtersOpen = false, onToggleFilters, isBrowsing = false, browseSort = 'newest', onBrowseSortChange, browseTotal = null, showBrowseHint = false, onDismissBrowseHint }) {
  const { t } = useTranslation('search');
  const backdropDismiss = useBackdropDismiss(handleCloseSearchResults);

  const isShowing = Boolean(showSearchResults && results.length > 0 && uiTheme === 'terminal');
  // Esc closes the console when it is the top view (the filters panel or a video group over it close first).
  // On a phone, Back closes it too, which clears the search like the Close button does.
  useEscapeKey(isShowing, handleCloseSearchResults);
  useBackToClose(isShowing, handleCloseSearchResults);

  if (!isShowing) return null;

  // Counted like Max Results: every image once, every video once (not its frames).
  const matchCount = imageResults.length + videoGroups.length;
  const itemCount = browseTotal ?? matchCount;
  const sortWords = browseSort === 'oldest' ? t('terminal.oldestFirst') : t('terminal.newestFirst');
  const browsingLine = browseSort === 'oldest' ? t('terminal.browsingOldest') : t('terminal.browsingNewest');
  const HeaderIcon = isBrowsing ? Library : Search;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 sm:p-6 animate-in fade-in duration-200"
      {...backdropDismiss}
    >
      <div
        className="flex h-dvh w-full max-w-7xl flex-col bg-black px-safe pt-safe pb-safe sm:h-auto sm:max-h-[86dvh] sm:border sm:border-white sm:p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white p-3 sm:flex-nowrap sm:gap-4 sm:p-5">
          <HeaderIcon className="w-6 h-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{isBrowsing ? t('results.library') : t('results.searchResults')}</h2>
            <p className="mt-1 truncate text-sm">
              {isBrowsing ? browsingLine : imageSearchContext ? t('terminal.image', { context: imageSearchContext }) : t('terminal.query', { query })}
            </p>
          </div>
          <div className="order-2 flex w-full flex-wrap items-center gap-2 empty:hidden sm:order-none sm:contents">
            <span className="border border-white px-3 py-2 text-sm font-bold">
              {isBrowsing ? t('terminal.items', { count: itemCount }) : t('terminal.matches', { count: matchCount })}
            </span>
            {isBrowsing && <BrowseSortToggle sort={browseSort} onChange={onBrowseSortChange} variant="terminal" />}
            <SearchFiltersButton activeCount={activeFilterCount} isOpen={filtersOpen} onToggle={onToggleFilters} />
          </div>
          <button
            onClick={handleCloseSearchResults}
            className="icon-tile order-1 flex h-10 w-10 flex-shrink-0 items-center justify-center border border-white sm:order-none sm:h-12 sm:w-12"
            aria-label={t('terminal.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isBrowsing && showBrowseHint && (
          <div className="border-b border-white px-3 py-3 sm:px-5">
            <BrowseHint onDismiss={onDismissBrowseHint} />
          </div>
        )}

        <ActiveFilterChips chips={filterChips} onClearAll={onClearFilters} className="border-b border-white px-3 py-3 sm:px-5" />

        <div className="custom-scrollbar min-h-0 overflow-y-auto p-3 sm:p-6">
          {videoGroups.length > 0 && (
            <section className={imageResults.length > 0 ? 'mb-10' : ''}>
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white pb-3">
                <FolderOpen className="w-5 h-5" />
                <h3 className="text-lg font-bold">{isBrowsing ? t('results.videos') : t('results.videoResults')}</h3>
                <span className="border border-white px-2 py-0.5 text-xs font-bold">{videoGroups.length}</span>
                <span className="ml-auto text-xs">{isBrowsing ? sortWords : t('terminal.sortedByBestMatch')}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
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
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white pb-3">
                  <ImageIcon className="w-5 h-5" />
                  <h3 className="text-lg font-bold">{isBrowsing ? t('results.images') : t('results.imageResults')}</h3>
                  <span className="border border-white px-2 py-0.5 text-xs font-bold">{imageResults.length}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
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
                    className="min-h-10 px-6 py-2.5 bg-black border border-white text-white hover:bg-white hover:text-black font-bold text-xs transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('terminal.loadMore', { shown: visibleResultsCount, total: imageResults.length })}</span>
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
