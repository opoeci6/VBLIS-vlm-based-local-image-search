import { useEffect, useRef } from 'react';
import { FolderOpen, Loader2, Trash2, RefreshCw, CheckSquare, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IndexedFolderTree } from './IndexedFolderTree';
import { cn } from '../../utils/cn';

export const IndexedFoldersPanel = ({ isFoldersExpanded, setIsFoldersExpanded, suppressCollapse, indexedFolders, isFetchingFolders, selectedFolders, allSelectableFolderPaths, toggleSelectAll, toggleFolderSelection, isBatchProcessing, handleBatchReindex, handleBatchDelete, handleOpenFolder, handleBrowseFolderContents, handleReindexFolder, handleDeleteFolderIndex, status, uiTheme }) => {
  const { t } = useTranslation('folders');
  const foldersRef = useRef(null);

  useEffect(() => {
    if (!isFoldersExpanded) return;
    const handleClickOutside = (e) => {
      // If a modal, lightbox, or drawer is active or being clicked, do not collapse indexed folders
      if (suppressCollapse) {
        return;
      }
      // If clicking any header control, button, dialog, modal, drawer, or input, do not collapse
      if (e.target.closest?.('.fixed, [role="dialog"], header, nav, button, a, input, select, [data-no-collapse]')) {
        return;
      }
      if (foldersRef.current && !foldersRef.current.contains(e.target)) {
        setIsFoldersExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFoldersExpanded, suppressCollapse, setIsFoldersExpanded]);

  return (
    <section data-ascii-protected="true" className="w-full max-w-7xl px-6 mb-3 relative z-30">
      <div
        ref={foldersRef}
        className="bg-white dark:bg-neutral-900/70 border border-gray-200 dark:border-neutral-800 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20 transition-all duration-200"
      >
        <div
          className="px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-indigo-500/5 dark:bg-indigo-500/10 cursor-pointer select-none transition-colors hover:bg-indigo-500/10 dark:hover:bg-indigo-500/15 rounded-3xl"
          onClick={() => setIsFoldersExpanded(prev => !prev)}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-neutral-900 dark:text-white">{t('panel.title')}</h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[10px] font-extrabold border border-indigo-200/60 dark:border-indigo-500/30">
                  {indexedFolders.length}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                {isFoldersExpanded ? t('panel.hintExpanded') : t('panel.hintCollapsed')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex items-center justify-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all hover:scale-[1.02] active:scale-95 text-xs font-bold shadow-md shadow-indigo-500/20 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              {t('panel.addFolders')}
            </button>
            <button
              type="button"
              onClick={() => setIsFoldersExpanded(prev => !prev)}
              className="p-2 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all cursor-pointer"
              title={isFoldersExpanded ? t('panel.collapse') : t('panel.expand')}
              aria-expanded={isFoldersExpanded}
            >
              {isFoldersExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {isFoldersExpanded && (
          <div
            className={cn(
              "animate-in slide-in-from-top-2 fade-in duration-200 absolute top-[calc(100%+8px)] left-6 right-6 z-40 overflow-hidden",
              uiTheme === 'modern'
                ? "bg-white/95 dark:bg-neutral-900/95 backdrop-blur-2xl border border-gray-200 dark:border-neutral-800 rounded-3xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
                : "bg-white dark:bg-black border border-black dark:border-white shadow-2xl"
            )}
          >
            {indexedFolders.length > 0 && (
              <div className="px-6 py-3 bg-gray-50/70 dark:bg-neutral-800/20 border-b border-gray-100 dark:border-neutral-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                >
                  {selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0
                    ? <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    : <Square className="w-4 h-4" />}
                  {selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0 ? t('panel.deselectAll') : t('panel.selectAll')}
                </button>

                <div className="flex items-center gap-2 min-h-8">
                  {selectedFolders.length > 0 ? (
                    <>
                      <span className="text-[10px] text-neutral-500 font-bold mr-1">{t('panel.selected', { count: selectedFolders.length })}</span>
                      <button
                        type="button"
                        onClick={handleBatchReindex}
                        disabled={isBatchProcessing || status.is_indexing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isBatchProcessing && "animate-spin")} />
                        {t('panel.reindex')}
                      </button>
                      <button
                        type="button"
                        onClick={handleBatchDelete}
                        disabled={isBatchProcessing || status.is_indexing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t('panel.delete')}
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] text-neutral-500 italic">{t('panel.batchHint')}</span>
                  )}
                </div>
              </div>
            )}

            <div className="p-4 max-h-[380px] overflow-y-auto custom-scrollbar">
              {isFetchingFolders && indexedFolders.length === 0 ? (
                <div className="flex items-center justify-center gap-3 py-12 text-neutral-500">
                  <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                  <span className="text-sm font-medium">{t('panel.fetching')}</span>
                </div>
              ) : indexedFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <div className="icon-tile w-14 h-14 bg-gray-100 dark:bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
                    <FolderOpen className="w-7 h-7 text-neutral-400 dark:text-neutral-600" />
                  </div>
                  <h3 className="text-base font-bold text-neutral-800 dark:text-neutral-300">{t('panel.empty.title')}</h3>
                  <p className="text-sm text-neutral-500 mt-2 max-w-md">{t('panel.empty.desc')}</p>
                </div>
              ) : (
                <IndexedFolderTree
                  folders={indexedFolders}
                  selectedPaths={selectedFolders}
                  onToggleSelection={toggleFolderSelection}
                  onBrowse={handleBrowseFolderContents}
                  onReindex={handleReindexFolder}
                  onDelete={handleDeleteFolderIndex}
                  isIndexing={status.is_indexing}
                  uiTheme={uiTheme}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
