import { Settings, X } from 'lucide-react';
import { ThemeStyleSection } from './ThemeStyleSection';
import { PerformanceSection } from './PerformanceSection';
import { ModelManagementSection } from './ModelManagementSection';
import { SearchTuningSection } from './SearchTuningSection';
import { IndexDangerZone } from './IndexDangerZone';
import { ThumbnailCacheSection } from './ThumbnailCacheSection';

export const SettingsModal = ({ showSettings, setShowSettings, uiTheme, setUiTheme, gpuSettings, status, isSwitchingGpu, handleToggleGpu, handleUpdatePerformanceSettings, models, pendingModel, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel, minScore, setMinScore, maxResults, setMaxResults, showConfirmClear, setShowConfirmClear, handleClearCache, isClearing, cacheStats, showConfirmClearThumbnails, setShowConfirmClearThumbnails, handleClearThumbnailCache, isClearingThumbnails, handleRebuildVideoThumbnails, isTriggeringRebuildThumbnails }) => {
  if (!(showSettings)) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-[480px] max-w-full animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={() => setShowSettings(false)}
          className="absolute top-3 right-3 sm:top-1 sm:-right-14 z-10 p-3 bg-white/95 dark:bg-neutral-900/95 border border-gray-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-white dark:hover:bg-neutral-800 rounded-2xl shadow-xl transition-all"
          title="Close settings"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 p-6 rounded-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl custom-scrollbar">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-neutral-900 dark:text-white">
            <Settings className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> Settings
          </h2>
          <div className="space-y-6">
            {/* Theme Style Selection */}
            <ThemeStyleSection
              uiTheme={uiTheme}
              setUiTheme={setUiTheme}
            />

            <PerformanceSection
              gpuSettings={gpuSettings}
              status={status}
              uiTheme={uiTheme}
              isSwitchingGpu={isSwitchingGpu}
              handleToggleGpu={handleToggleGpu}
              handleUpdatePerformanceSettings={handleUpdatePerformanceSettings}
            />

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

            <SearchTuningSection
              minScore={minScore}
              setMinScore={setMinScore}
              maxResults={maxResults}
              setMaxResults={setMaxResults}
            />

            <IndexDangerZone
              showConfirmClear={showConfirmClear}
              setShowConfirmClear={setShowConfirmClear}
              handleClearCache={handleClearCache}
              isClearing={isClearing}
              models={models}
            />

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
          </div>
        </div>
      </div>
    </div>
  );
};
