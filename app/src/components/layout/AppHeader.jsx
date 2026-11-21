import { Settings, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueueStatusBadge } from '../queue/QueueStatusBadge';
import { SearchBar } from './SearchBar';
import { HeaderMenu } from './HeaderMenu';
import { useSession } from '../../session/sessionContext';

// On a phone (below md) the header has three rows: the logo with the model chip on the left and the queue badge,
// the menu and the gear on the right; the search box; the Filters, picture and Search buttons. From md up it is one row.
export const AppHeader = ({ models, openSettings, queue, uiTheme, handleSearch, isSearching, searchInputRef, query, setQuery, activeFilterCount, filtersOpen, onToggleFilters, hasSearchResults = false, onClearSearch, onPickImage, theme, setTheme, setUiTheme }) => {
  const { t } = useTranslation('search');
  const { isOwner, mode } = useSession();
  return (
    <header data-ascii-protected="true" className="w-full max-w-7xl px-4 sm:px-6 py-3 sm:py-8 flex flex-wrap items-center justify-between gap-x-3 gap-y-3 md:flex-nowrap md:gap-6 relative md:mt-4">
      <div className="order-1 flex min-w-0 flex-1 items-center gap-3 md:flex-none">
        <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
          <ImageIcon className="w-5 h-5" />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">VBLIS</h1>
          </div>
          {models.active_model ? (
            <div className="mt-0.5 flex min-w-0">
              <button
                onClick={() => openSettings('models')}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-2 py-0.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 cursor-pointer shadow-sm"
                title={t('header.activeModelTitle', { model: models.active_model })}
              >
                <div className="model-status-dot model-status-dot-online w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" aria-hidden="true" />
                <span className="font-mono text-[10px] truncate max-w-[200px]">{models.active_model.split('/').pop()}</span>
              </button>
            </div>
          ) : (
            <div className="mt-0.5 flex min-w-0">
              <button
                onClick={() => openSettings('models')}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-2 py-0.5 bg-amber-50/80 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200/80 dark:border-amber-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-amber-600 dark:text-amber-400 cursor-pointer shadow-sm"
                title={t('header.noModelTitle')}
              >
                <div className="model-status-dot model-status-dot-offline w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true" />
                <span className="font-mono text-[10px] tracking-wider uppercase truncate">{t('header.noModel')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="order-3 w-full basis-full md:order-2 md:flex-1 md:basis-auto md:min-w-0 md:flex md:justify-center">
        <SearchBar handleSearch={handleSearch} isSearching={isSearching} searchInputRef={searchInputRef} query={query} setQuery={setQuery} activeFilterCount={activeFilterCount} filtersOpen={filtersOpen} onToggleFilters={onToggleFilters} hasSearchResults={hasSearchResults} onClearSearch={onClearSearch} onPickImage={onPickImage} />
      </div>

      <div className="order-2 flex flex-shrink-0 items-center gap-2 md:order-3">
        {isOwner && <QueueStatusBadge queue={queue} uiTheme={uiTheme} />}
        {mode === 'network' && <HeaderMenu theme={theme} setTheme={setTheme} uiTheme={uiTheme} setUiTheme={setUiTheme} />}
        <button
          onClick={() => openSettings()}
          aria-label={t('settings:settingsModal.title')}
          title={t('settings:settingsModal.title')}
          className="p-2.5 sm:p-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all hover:rotate-45 active:scale-95 text-neutral-500 hover:text-neutral-900 dark:hover:text-white shadow-sm dark:shadow-none"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
