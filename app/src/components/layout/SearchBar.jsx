import { useRef } from 'react';
import { Search, Loader2, X, ImagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SearchFiltersButton } from '../search/filters/SearchFiltersButton';
import { cn } from '../../utils/cn';
import { useSession } from '../../session/sessionContext';

// A button of the row under the search box: at least 44 px tall and sharing the width on a phone, its own size from sm up.
const PHONE_ROW_BUTTON = 'min-h-[44px] flex-1 justify-center px-3 sm:min-h-0 sm:flex-none sm:px-4';

export const SearchBar = ({ handleSearch, isSearching, searchInputRef, query, setQuery, activeFilterCount = 0, filtersOpen = false, onToggleFilters, hasSearchResults = false, onClearSearch, onPickImage }) => {
  const { t } = useTranslation('search');
  const { mode, may } = useSession();
  const pictureInputRef = useRef(null);
  // A browser has no drag and drop of paths to rely on, so it gets a button. The desktop app keeps its drop.
  const canPickImage = mode === 'network' && may('image_search') && Boolean(onPickImage);
  return (
  <form onSubmit={handleSearch} className="flex-1 max-w-2xl w-full relative group flex flex-col gap-2 sm:flex-row">
    <div className="relative sm:flex-1">
      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
        {isSearching ? <Loader2 className="w-5 h-5 text-neutral-400 dark:text-neutral-500 animate-spin" /> : <Search className="w-5 h-5 text-neutral-400 dark:text-neutral-500 group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400 transition-colors" />}
      </div>
      <input
        ref={searchInputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchBar.placeholder')}
        className="w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-2xl py-3 sm:py-4 pl-12 pr-12 text-base outline-none transition-all duration-300 focus:bg-white dark:focus:bg-neutral-900 focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 shadow-xl shadow-black/5 dark:shadow-black/20 text-neutral-900 dark:text-white"
      />
      {(query.length > 0 || hasSearchResults) && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            // With a search behind the box (results, or none found), clear the results too and go back to the main page
            if (hasSearchResults && onClearSearch) onClearSearch();
            else setQuery('');
            searchInputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-3 flex items-center justify-center px-2"
          aria-label={t('searchBar.clear')}
          title={t('searchBar.clear')}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
    {/* On a phone the buttons sit in a row of their own under the box and share its width. From sm up the row
        disappears (display: contents) and they stand next to the box as before. */}
    <div className="flex gap-2 sm:contents">
      <SearchFiltersButton activeCount={activeFilterCount} isOpen={filtersOpen} onToggle={onToggleFilters} className={PHONE_ROW_BUTTON} />
      {canPickImage && (
        <>
          <input
            ref={pictureInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="picture-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so that choosing the same file again fires change again.
              event.target.value = '';
              if (file) onPickImage(file);
            }}
          />
          <button
            type="button"
            onClick={() => pictureInputRef.current?.click()}
            title={t('searchBar.pickImage')}
            aria-label={t('searchBar.pickImage')}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-3 border rounded-2xl transition-all active:scale-95 shadow-sm cursor-pointer whitespace-nowrap text-sm font-medium bg-white dark:bg-neutral-900/50 border-gray-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800',
              PHONE_ROW_BUTTON
            )}
          >
            <ImagePlus className="w-4 h-4" aria-hidden="true" />
            <span className="sm:hidden">{t('filters:button.pictureText')}</span>
          </button>
        </>
      )}
      <button
        type="submit"
        className={cn(
          'px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all hover:scale-105 active:scale-95 font-medium text-sm shadow-lg shadow-indigo-500/20',
          PHONE_ROW_BUTTON,
          'sm:px-5'
        )}
      >
        {t('searchBar.submit')}
      </button>
    </div>
  </form>
  );
};
