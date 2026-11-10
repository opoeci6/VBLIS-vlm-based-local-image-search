import { Search, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SearchFiltersButton } from '../search/filters/SearchFiltersButton';

export const SearchBar = ({ handleSearch, isSearching, searchInputRef, query, setQuery, activeFilterCount = 0, filtersOpen = false, onToggleFilters, hasSearchResults = false, onClearSearch }) => {
  const { t } = useTranslation('search');
  return (
  <form onSubmit={handleSearch} className="flex-1 max-w-2xl w-full relative group flex gap-2">
    <div className="relative flex-1">
      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
        {isSearching ? <Loader2 className="w-5 h-5 text-neutral-400 dark:text-neutral-500 animate-spin" /> : <Search className="w-5 h-5 text-neutral-400 dark:text-neutral-500 group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400 transition-colors" />}
      </div>
      <input
        ref={searchInputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchBar.placeholder')}
        className="w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-2xl py-4 pl-12 pr-12 text-base outline-none transition-all duration-300 focus:bg-white dark:focus:bg-neutral-900 focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 shadow-xl shadow-black/5 dark:shadow-black/20 text-neutral-900 dark:text-white"
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
    <SearchFiltersButton activeCount={activeFilterCount} isOpen={filtersOpen} onToggle={onToggleFilters} />
    <button
      type="submit"
      className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all hover:scale-105 active:scale-95 font-medium text-sm shadow-lg shadow-indigo-500/20"
    >
      {t('searchBar.submit')}
    </button>
  </form>
  );
};
