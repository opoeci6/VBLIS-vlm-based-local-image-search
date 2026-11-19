import { Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThemeStyleSection } from './ThemeStyleSection';
import { LanguageSection } from './LanguageSection';
import { PerformanceSection } from './PerformanceSection';
import { ModelManagementSection } from './ModelManagementSection';
import { SearchTuningSection } from './SearchTuningSection';
import { IndexDangerZone } from './IndexDangerZone';
import { ThumbnailCacheSection } from './ThumbnailCacheSection';
import { ServerSection } from './ServerSection';
import { SharingSection } from './SharingSection';
import { AccountSection } from './AccountSection';
import { useSession } from '../../session/sessionContext';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export const SettingsModal = ({ showSettings, setShowSettings, uiTheme, setUiTheme, gpuSettings, status, isSwitchingGpu, handleToggleGpu, handleUpdatePerformanceSettings, models, pendingModel, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel, minScore, setMinScore, minSimilarity, setMinSimilarity, maxResults, setMaxResults, resetSearchTuning, showConfirmClear, setShowConfirmClear, handleClearCache, isClearing, cacheStats, showConfirmClearThumbnails, setShowConfirmClearThumbnails, handleClearThumbnailCache, isClearingThumbnails, handleRebuildVideoThumbnails, isTriggeringRebuildThumbnails, setToast }) => {
  const { t } = useTranslation('settings');
  // A viewer only gets the sections that are about their own browser: theme, language and search tuning.
  const { isOwner, mode } = useSession();
  const close = () => setShowSettings(false);
  // Esc first cancels an open inline confirmation (clear index, delete a model, clear thumbnails), then closes.
  const cancelOpenConfirmation = () => {
    if (showConfirmClear) setShowConfirmClear(false);
    else if (showConfirmDeleteModel) setShowConfirmDeleteModel(null);
    else if (showConfirmClearThumbnails) setShowConfirmClearThumbnails(null);
    else return false;
    return true;
  };
  useEscapeKey(showSettings, () => {
    if (!cancelOpenConfirmation()) close();
  });
  useBackToClose(showSettings, close);
  const backdropDismiss = useBackdropDismiss(close);
  if (!(showSettings)) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      {...backdropDismiss}
    >
      <div className="relative w-full max-w-full animate-in fade-in zoom-in-95 duration-200 sm:w-[480px]">
        <button
          type="button"
          onClick={close}
          className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] sm:top-1 sm:-right-14 z-10 flex h-10 w-10 items-center justify-center sm:h-auto sm:w-auto sm:p-3 bg-white/95 dark:bg-neutral-900/95 border border-gray-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-white dark:hover:bg-neutral-800 rounded-xl sm:rounded-2xl shadow-xl transition-all"
          title={t('settingsModal.closeTooltip')}
          aria-label={t('settingsModal.closeTooltip')}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-white dark:bg-neutral-900 pt-safe pb-safe px-safe sm:p-0 sm:border border-gray-200 dark:border-neutral-800 sm:rounded-2xl w-full h-dvh sm:h-auto sm:max-h-[90dvh] overflow-y-auto shadow-2xl custom-scrollbar">
          <div className="p-4 sm:p-6">
            <h2 className="text-xl font-bold mb-4 pr-12 sm:pr-0 flex items-center gap-2 text-neutral-900 dark:text-white">
              <Settings className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> {t('settingsModal.title')}
            </h2>
            <div className="space-y-6">
              {/* Theme Style Selection */}
              <ThemeStyleSection
                uiTheme={uiTheme}
                setUiTheme={setUiTheme}
              />

              <LanguageSection />

              {isOwner && (
                <PerformanceSection
                  gpuSettings={gpuSettings}
                  status={status}
                  uiTheme={uiTheme}
                  isSwitchingGpu={isSwitchingGpu}
                  handleToggleGpu={handleToggleGpu}
                  handleUpdatePerformanceSettings={handleUpdatePerformanceSettings}
                />
              )}

              {isOwner && (
                <ModelManagementSection
                  models={models}
                  status={status}
                  pendingModel={pendingModel}
                  uiTheme={uiTheme}
                  handleUnloadModel={handleUnloadModel}
                  isUnloadingModel={isUnloadingModel}
                  handleModelSwitch={handleModelSwitch}
                  isSwitchingModel={isSwitchingModel}
                  setPendingModel={setPendingModel}
                  handleDownloadModel={handleDownloadModel}
                  handleCancelDownload={handleCancelDownload}
                  showConfirmDeleteModel={showConfirmDeleteModel}
                  setShowConfirmDeleteModel={setShowConfirmDeleteModel}
                  deleteIndexWithModel={deleteIndexWithModel}
                  setDeleteIndexWithModel={setDeleteIndexWithModel}
                  handleDeleteModel={handleDeleteModel}
                  isDeletingModel={isDeletingModel}
                />
              )}

              <SearchTuningSection
                minScore={minScore}
                setMinScore={setMinScore}
                minSimilarity={minSimilarity}
                setMinSimilarity={setMinSimilarity}
                maxResults={maxResults}
                setMaxResults={setMaxResults}
                resetSearchTuning={resetSearchTuning}
              />

              {isOwner && (
                <IndexDangerZone
                  showConfirmClear={showConfirmClear}
                  setShowConfirmClear={setShowConfirmClear}
                  handleClearCache={handleClearCache}
                  isClearing={isClearing}
                  models={models}
                />
              )}

              {isOwner && (
                <ThumbnailCacheSection
                  cacheStats={cacheStats}
                  showConfirmClearThumbnails={showConfirmClearThumbnails}
                  setShowConfirmClearThumbnails={setShowConfirmClearThumbnails}
                  handleClearThumbnailCache={handleClearThumbnailCache}
                  isClearingThumbnails={isClearingThumbnails}
                  status={status}
                  handleRebuildVideoThumbnails={handleRebuildVideoThumbnails}
                  isTriggeringRebuildThumbnails={isTriggeringRebuildThumbnails}
                />
              )}
              {/* Who is signed in from a browser: any role changes its own password here */}
              {mode === 'network' && <AccountSection uiTheme={uiTheme} setToast={setToast} />}
              {/* Sharing from the Windows app: the desktop's only owner turns it on and manages its accounts here */}
              {mode === 'desktop' && <SharingSection uiTheme={uiTheme} setToast={setToast} />}
              {/* The network server's own settings: its owner changes them from a browser */}
              {mode === 'network' && isOwner && <ServerSection uiTheme={uiTheme} setToast={setToast} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
