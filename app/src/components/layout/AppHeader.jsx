import { Settings, Image as ImageIcon } from 'lucide-react';
import { QueueStatusBadge } from '../queue/QueueStatusBadge';
import { SearchBar } from './SearchBar';

export const AppHeader = ({ models, setShowSettings, queue, uiTheme, handleSearch, isSearching, searchInputRef, query, setQuery }) => {
  return (
    <header data-ascii-protected="true" className="w-full max-w-7xl px-6 py-8 flex gap-6 items-center flex-col md:flex-row justify-between relative mt-4">
      <div className="flex items-center gap-3">
        <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
          <ImageIcon className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">VBLIS</h1>
          </div>
          {models.active_model ? (
            <div className="mt-0.5">
              <button
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 cursor-pointer shadow-sm"
                title={`Active Vision Engine: ${models.active_model} (Click to manage models)`}
              >
                <div className="model-status-dot model-status-dot-online w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" aria-hidden="true" />
                <span className="font-mono text-[10px] truncate max-w-[200px]">{models.active_model.split('/').pop()}</span>
              </button>
            </div>
          ) : (
            <div className="mt-0.5">
              <button
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-50/80 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200/80 dark:border-amber-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-amber-600 dark:text-amber-400 cursor-pointer shadow-sm"
                title="No model currently loaded into memory. Click to select and activate a model in Settings."
              >
                <div className="model-status-dot model-status-dot-offline w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true" />
                <span className="font-mono text-[10px] tracking-wider uppercase">No Model Loaded</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <SearchBar handleSearch={handleSearch} isSearching={isSearching} searchInputRef={searchInputRef} query={query} setQuery={setQuery} />

      <div className="flex items-center gap-2">
        <QueueStatusBadge queue={queue} uiTheme={uiTheme} />
        <button
          onClick={() => setShowSettings(true)}
          className="p-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all hover:rotate-45 active:scale-95 text-neutral-500 hover:text-neutral-900 dark:hover:text-white shadow-sm dark:shadow-none"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
