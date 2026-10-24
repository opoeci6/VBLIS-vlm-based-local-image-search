import { useState, useRef, useCallback } from 'react';
import TitleBar from './TitleBar';
import { API_BASE } from './config';
import { cn } from './utils/cn';
import { useTaskQueue } from './hooks/useTaskQueue';
import { useThemePreferences } from './hooks/useThemePreferences';
import { useToast } from './hooks/useToast';
import { useBackendStatus } from './hooks/useBackendStatus';
import { useModelManager } from './hooks/useModelManager';
import { useMediaSearch } from './hooks/useMediaSearch';
import { useFileDrop } from './hooks/useFileDrop';
import { useIndexedFolders } from './hooks/useIndexedFolders';
import { useFolderContents } from './hooks/useFolderContents';
import { useCacheStats } from './hooks/useCacheStats';
import { QueueDrawer } from './components/queue/QueueDrawer';
import { ModelSwitchWarningModal } from './components/modals/ModelSwitchWarningModal';
import { DragOverlay } from './components/common/DragOverlay';
import { Toast } from './components/common/Toast';
import { AppHeader } from './components/layout/AppHeader';
import { IndexingStatusBar } from './components/status/IndexingStatusBar';
import { IndexingErrorsAlert } from './components/status/IndexingErrorsAlert';
import { ModelLoadErrorBanner } from './components/status/ModelLoadErrorBanner';
import { ModelDownloadBanner } from './components/status/ModelDownloadBanner';
import { ImageSearchChip } from './components/search/ImageSearchChip';
import { NoMatches, BackendLoading, ModelSetupState, ReadyToSearch } from './components/home/EmptyStates';
import { IndexedFoldersPanel } from './components/folders/IndexedFoldersPanel';
import { VideoGroupModal } from './components/search/VideoGroupModal';
import { MediaLightbox } from './components/media/MediaLightbox';
import { SearchResultsGrid } from './components/search/SearchResultsGrid';
import { TerminalResultsModal } from './components/search/TerminalResultsModal';
import { FolderContentsModal } from './components/folders/FolderContentsModal';
import { SettingsModal } from './components/settings/SettingsModal';

function App() {
  const [isClearing, setIsClearing] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedVideoGroup, setSelectedVideoGroup] = useState(null);
  const [isFoldersExpanded, setIsFoldersExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const { theme, setTheme, uiTheme, setUiTheme } = useThemePreferences();
  const { toast, setToast } = useToast();
  const queue = useTaskQueue(API_BASE, setToast);
  // Stable so the memoized results modal does not re-render on unrelated App commits.
  const handleSearchResultsClosed = useCallback(() => {
    setSelectedImage(null);
    setSelectedVideoGroup(null);
  }, []);
  const {
    query,
    setQuery,
    results,
    isSearching,
    hasSearched,
    showSearchResults,
    minScore,
    setMinScore,
    maxResults,
    setMaxResults,
    visibleResultsCount,
    setVisibleResultsCount,
    imageSearchContext,
    imageResults,
    visibleImageResults,
    videoGroups,
    sentinelRef,
    sentinelTerminalRef,
    handleSearch,
    handleImageDrop,
    handleCloseSearchResults,
    handleClearImageSearch,
    refreshSearch,
    resetSearch
  } = useMediaSearch({
    setToast,
    onSearchStart: () => setIsFoldersExpanded(false),
    onClose: handleSearchResultsClosed
  });
  const { status, setStatus, showErrorAlert, setShowErrorAlert, isCancellingIndexing, handleCancelIndexing } = useBackendStatus({ setToast });
  const {
    modelLoadError,
    setModelLoadError,
    models,
    pendingModel,
    setPendingModel,
    backendReady,
    isSwitchingModel,
    isUnloadingModel,
    isDeletingModel,
    deleteIndexWithModel,
    setDeleteIndexWithModel,
    showConfirmDeleteModel,
    setShowConfirmDeleteModel,
    modelSwitchWarning,
    setModelSwitchWarning,
    gpuSettings,
    isSwitchingGpu,
    handleUpdatePerformanceSettings,
    handleToggleGpu,
    handleModelSwitch,
    executeModelSwitch,
    handleUnloadModel,
    handleCancelDownload,
    handleDownloadModel,
    handleDeleteModel
  } = useModelManager({
    status,
    setStatus,
    queue,
    setToast,
    onSwitchStart: () => {
      setShowSettings(false);
      resetSearch();
    }
  });
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useFileDrop({
    enabled: Boolean(models.active_model),
    setToast,
    onFolders: queue.enqueueFolderIndexing,
    onImage: handleImageDrop
  });
  const {
    indexedFolders,
    isFetchingFolders,
    selectedFolders,
    isBatchProcessing,
    fetchIndexedFolders,
    handleReindexFolder,
    handleDeleteFolderIndex,
    handleBatchDelete,
    handleBatchReindex,
    allSelectableFolderPaths,
    toggleFolderSelection,
    toggleSelectAll
  } = useIndexedFolders({
    activeModel: models.active_model,
    lastTaskId: status.last_task_id,
    isExpanded: isFoldersExpanded,
    setToast,
    onIndexChanged: refreshSearch
  });
  const {
    showFolderContents,
    browsingFolder,
    folderContents,
    isFetchingFolderContents,
    isCleaningGhostRecords,
    setIsCleaningGhostRecords,
    folderVisibleLimit,
    setFolderVisibleLimit,
    handleBrowseFolderContents,
    handleCloseFolderContents
  } = useFolderContents({
    activeModel: models.active_model,
    lastTaskId: status.last_task_id,
    setToast,
    refreshFolders: fetchIndexedFolders
  });
  const {
    cacheStats,
    isClearingThumbnails,
    showConfirmClearThumbnails,
    setShowConfirmClearThumbnails,
    isTriggeringRebuildThumbnails,
    handleClearThumbnailCache,
    handleRebuildVideoThumbnails
  } = useCacheStats({ isSettingsOpen: showSettings, status, setToast });
  const searchInputRef = useRef(null);

  const handleOpenFolder = async () => {
    if (!window.electronAPI) return;
    const paths = await window.electronAPI.openDirectory();
    if (paths && paths.length > 0) {
      await queue.enqueueFolderIndexing(paths);
    }
  };

  const handleClearCache = async () => {
    if (!models.active_model) return;

    setIsClearing(true);
    try {
      await fetch(`${API_BASE}/index/clear`, {
        method: 'POST'
      });
      // Reset UI cleanly
      resetSearch();
      setSelectedImage(null);
      setSelectedVideoGroup(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearing(false);
      setShowConfirmClear(false);
      setShowSettings(false); // Optionally close modal on success
    }
  };

  return (
    <div
      className={cn(
        "isolate h-screen w-full overflow-y-auto overflow-x-hidden font-sans flex flex-col items-center relative pt-8 custom-scrollbar",
        uiTheme === 'terminal' ? "terminal-theme theme-terminal" : "theme-modern bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TitleBar theme={theme} setTheme={setTheme} uiTheme={uiTheme} setUiTheme={setUiTheme} />

      {/* Drag Overlay */}
      {isDragging && <DragOverlay activeTask={queue.activeTask} pendingCount={queue.pendingCount} />}

      {/* Settings Modal */}
      <SettingsModal
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        uiTheme={uiTheme}
        setUiTheme={setUiTheme}
        gpuSettings={gpuSettings}
        status={status}
        isSwitchingGpu={isSwitchingGpu}
        handleToggleGpu={handleToggleGpu}
        handleUpdatePerformanceSettings={handleUpdatePerformanceSettings}
        models={models}
        pendingModel={pendingModel}
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
        minScore={minScore}
        setMinScore={setMinScore}
        maxResults={maxResults}
        setMaxResults={setMaxResults}
        showConfirmClear={showConfirmClear}
        setShowConfirmClear={setShowConfirmClear}
        handleClearCache={handleClearCache}
        isClearing={isClearing}
        cacheStats={cacheStats}
        showConfirmClearThumbnails={showConfirmClearThumbnails}
        setShowConfirmClearThumbnails={setShowConfirmClearThumbnails}
        handleClearThumbnailCache={handleClearThumbnailCache}
        isClearingThumbnails={isClearingThumbnails}
        handleRebuildVideoThumbnails={handleRebuildVideoThumbnails}
        isTriggeringRebuildThumbnails={isTriggeringRebuildThumbnails}
      />

      {/* Folder Contents Modal */}
      <FolderContentsModal showFolderContents={showFolderContents} browsingFolder={browsingFolder} folderContents={folderContents} isFetchingFolderContents={isFetchingFolderContents} isCleaningGhostRecords={isCleaningGhostRecords} setIsCleaningGhostRecords={setIsCleaningGhostRecords} folderVisibleLimit={folderVisibleLimit} setFolderVisibleLimit={setFolderVisibleLimit} handleCloseFolderContents={handleCloseFolderContents} handleReindexFolder={handleReindexFolder} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} />

      {/* Header */}
      <AppHeader models={models} setShowSettings={setShowSettings} queue={queue} uiTheme={uiTheme} handleSearch={handleSearch} isSearching={isSearching} searchInputRef={searchInputRef} query={query} setQuery={setQuery} />

      {/* Global Status Bar */}
      <IndexingStatusBar status={status} queue={queue} setToast={setToast} setShowSettings={setShowSettings} isCancellingIndexing={isCancellingIndexing} handleCancelIndexing={handleCancelIndexing} />

      {/* Indexing Errors Alert */}
      <IndexingErrorsAlert showErrorAlert={showErrorAlert} setShowErrorAlert={setShowErrorAlert} status={status} />

      <ModelLoadErrorBanner modelLoadError={modelLoadError} setModelLoadError={setModelLoadError} status={status} pendingModel={pendingModel} setPendingModel={setPendingModel} handleDownloadModel={handleDownloadModel} />

      <ModelDownloadBanner status={status} pendingModel={pendingModel} handleCancelDownload={handleCancelDownload} />

      {/* Returned video frames grouped by their source video */}
      <VideoGroupModal selectedVideoGroup={selectedVideoGroup} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} />

      {/* Lightbox Modal */}
      <MediaLightbox selectedImage={selectedImage} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} />

      {/* Global toast notification system */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* Inline / Floating Folder Manager */}
      {models.active_model && (
        <IndexedFoldersPanel
          isFoldersExpanded={isFoldersExpanded}
          setIsFoldersExpanded={setIsFoldersExpanded}
          suppressCollapse={Boolean(showFolderContents || selectedImage || selectedVideoGroup || showSettings || queue.isDrawerOpen)}
          indexedFolders={indexedFolders}
          isFetchingFolders={isFetchingFolders}
          selectedFolders={selectedFolders}
          allSelectableFolderPaths={allSelectableFolderPaths}
          toggleSelectAll={toggleSelectAll}
          toggleFolderSelection={toggleFolderSelection}
          isBatchProcessing={isBatchProcessing}
          handleBatchReindex={handleBatchReindex}
          handleBatchDelete={handleBatchDelete}
          handleOpenFolder={handleOpenFolder}
          handleBrowseFolderContents={handleBrowseFolderContents}
          handleReindexFolder={handleReindexFolder}
          handleDeleteFolderIndex={handleDeleteFolderIndex}
          status={status}
          uiTheme={uiTheme}
        />
      )}

      {/* Main Content Area */}
      <main className="w-full max-w-7xl px-6 pb-24 flex-1">
        <ImageSearchChip imageSearchContext={imageSearchContext} handleClearImageSearch={handleClearImageSearch} />

        {results.length === 0 && !isSearching && hasSearched && models.active_model && !isSwitchingModel && query.length > 0 && <NoMatches />}

        {(!backendReady || isSwitchingModel) && !status.is_downloading && <BackendLoading isSwitchingModel={isSwitchingModel} />}

        {backendReady && !isSwitchingModel && !models.active_model && !status.is_downloading && results.length === 0 && <ModelSetupState models={models} handleModelSwitch={handleModelSwitch} setShowSettings={setShowSettings} handleDownloadModel={handleDownloadModel} pendingModel={pendingModel} />}

        {models.active_model && !isSearching && query.length === 0 && results.length === 0 && !isSwitchingModel && <ReadyToSearch uiTheme={uiTheme} indexedFolders={indexedFolders} models={models} setShowSettings={setShowSettings} handleUnloadModel={handleUnloadModel} isUnloadingModel={isUnloadingModel} status={status} />}

        {/* In-page results grid for Modern theme */}
        <SearchResultsGrid results={results} uiTheme={uiTheme} videoGroups={videoGroups} imageResults={imageResults} visibleImageResults={visibleImageResults} visibleResultsCount={visibleResultsCount} setVisibleResultsCount={setVisibleResultsCount} sentinelRef={sentinelRef} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} />

        {/* Terminal Modal Console for Terminal theme */}
        <TerminalResultsModal showSearchResults={showSearchResults} results={results} uiTheme={uiTheme} handleCloseSearchResults={handleCloseSearchResults} imageSearchContext={imageSearchContext} query={query} videoGroups={videoGroups} imageResults={imageResults} visibleImageResults={visibleImageResults} visibleResultsCount={visibleResultsCount} setVisibleResultsCount={setVisibleResultsCount} sentinelTerminalRef={sentinelTerminalRef} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} />
      </main>

      {/* Background Task Queue Drawer */}
      <QueueDrawer
        isOpen={queue.isDrawerOpen}
        onClose={() => queue.setIsDrawerOpen(false)}
        queue={queue}
        uiTheme={uiTheme}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Model Switch Safeguard Warning Modal */}
      <ModelSwitchWarningModal
        isOpen={modelSwitchWarning.isOpen}
        mode={modelSwitchWarning.mode}
        targetModel={modelSwitchWarning.targetModel}
        activeTask={queue.activeTask}
        pendingCount={queue.pendingCount}
        onConfirmCancelAndSwitch={async () => {
          if (queue.activeTask) {
            await queue.cancelTask(queue.activeTask.id);
          }
          setTimeout(() => {
            executeModelSwitch(modelSwitchWarning.targetModel, false);
          }, 350);
        }}
        onConfirmProceedWithQueued={() => {
          executeModelSwitch(modelSwitchWarning.targetModel, false);
        }}
        onConfirmClearQueueAndSwitch={() => {
          executeModelSwitch(modelSwitchWarning.targetModel, true);
        }}
        onClose={() => setModelSwitchWarning(prev => ({ ...prev, isOpen: false }))}
        uiTheme={uiTheme}
      />
    </div>
  );
}

export default App;
