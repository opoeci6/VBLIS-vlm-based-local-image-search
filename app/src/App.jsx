import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import TitleBar from './TitleBar';
import { API_BASE } from './config';
import { cn } from './utils/cn';
import { useTaskQueue } from './hooks/useTaskQueue';
import { useThemePreferences } from './hooks/useThemePreferences';
import { useToast } from './hooks/useToast';
import { useBackendStatus } from './hooks/useBackendStatus';
import { useModelManager } from './hooks/useModelManager';
import { useMediaSearch } from './hooks/useMediaSearch';
import { useSearchFilters } from './hooks/useSearchFilters';
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
import { ActiveFilterChips } from './components/search/filters/ActiveFilterChips';
import { SearchFiltersPanel } from './components/search/filters/SearchFiltersPanel';
import { NoMatches, BackendLoading, ModelSetupState, ReadyToSearch } from './components/home/EmptyStates';
import { IndexedFoldersPanel } from './components/folders/IndexedFoldersPanel';
import { VideoGroupModal } from './components/search/VideoGroupModal';
import { MediaLightbox } from './components/media/MediaLightbox';
import { SearchResultsGrid } from './components/search/SearchResultsGrid';
import { TerminalResultsModal } from './components/search/TerminalResultsModal';
import { FolderContentsModal } from './components/folders/FolderContentsModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { FolderPickerModal } from './components/folders/FolderPickerModal';
import { HttpWarningBanner } from './components/status/HttpWarningBanner';
import { apiFetch } from './utils/api';
import { useSession } from './session/sessionContext';
import { ReplicaContext, useReplicaInfo } from './session/replicaContext';
import { isReadOnlyRefusal, readOnlyMessage, readRefusalBody } from './utils/replica';

function App() {
  const { mode, isOwner } = useSession();
  const [isClearing, setIsClearing] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  // Only the path is kept; the open group is derived from the live videoGroups below so it
  // picks up frames added by "Find more frames" and closes if its group disappears.
  const [selectedVideoPath, setSelectedVideoPath] = useState(null);
  const [isFoldersExpanded, setIsFoldersExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  // The picker for folders on the server, which is how the owner adds folders from a browser.
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const { theme, setTheme, uiTheme, setUiTheme } = useThemePreferences();
  const { toast, setToast } = useToast();
  const queue = useTaskQueue(API_BASE, setToast);
  const { status, setStatus, showErrorAlert, setShowErrorAlert, isCancellingIndexing, handleCancelIndexing } = useBackendStatus({ setToast });
  // Whether the library is a read-only copy of an index made on another computer (and what is known about it):
  // derived once here, handed to the hooks below and, through the context, to the components that hide actions.
  const replicaInfo = useReplicaInfo(status);
  const { readOnly, replica } = replicaInfo;
  // Stable so the memoized results modal does not re-render on unrelated App commits.
  const setSelectedVideoGroup = useCallback((group) => {
    setSelectedVideoPath(group ? group.path : null);
  }, []);
  const closeFolderPicker = useCallback(() => setShowFolderPicker(false), []);
  // Opens Settings, on a group when one is named (an id from settingsGroups.js); a click event or nothing opens it
  // on the group used last. Every call makes a new request object, so the window tells a new request even for the
  // same group.
  const [settingsRequest, setSettingsRequest] = useState(null);
  const openSettings = useCallback((group) => {
    setSettingsRequest({ group: typeof group === 'string' ? group : null });
    setShowSettings(true);
  }, []);
  const openSharingSettings = useCallback(() => openSettings('sharing'), [openSettings]);
  const handleSearchResultsClosed = useCallback(() => {
    setSelectedImage(null);
    setSelectedVideoPath(null);
  }, []);
  // A media details scan that is running or waiting in the queue.
  const mediaInfoScanActive = queue.activeTask?.type === 'SCAN_MEDIA_INFO'
    || queue.pendingTasks.some(task => task.type === 'SCAN_MEDIA_INFO');
  const searchFilters = useSearchFilters({
    setToast,
    activeTaskId: queue.activeTask?.id ?? null,
    scanActive: mediaInfoScanActive,
    readOnly
  });
  const {
    chips: filterChips,
    clearAll: clearFilters,
    requestFilters,
    activeCount: activeFilterCount,
    detailsFilterActive,
    missingDetails,
    readDetailsNow
  } = searchFilters;
  const {
    query,
    setQuery,
    results,
    isSearching,
    hasSearched,
    showSearchResults,
    minScore,
    setMinScore,
    minSimilarity,
    setMinSimilarity,
    maxResults,
    setMaxResults,
    resetSearchTuning,
    visibleResultsCount,
    setVisibleResultsCount,
    imageSearchContext,
    imageResults,
    visibleImageResults,
    videoGroups,
    expandVideo,
    expandingVideoPath,
    canExpandVideos,
    browseSort,
    setBrowseSort,
    isBrowsing,
    browseTotal,
    showBrowseHint,
    dismissBrowseHint,
    sentinelRef,
    sentinelTerminalRef,
    handleSearch,
    handleImageDrop,
    handleCloseSearchResults,
    handleClearImageSearch,
    refreshSearch,
    rerunCurrentSearch,
    resetSearch
  } = useMediaSearch({
    setToast,
    onSearchStart: () => setIsFoldersExpanded(false),
    onClose: handleSearchResultsClosed,
    filters: requestFilters
  });
  // The media details scan just finished: files that date, orientation and resolution filters used
  // to skip may match now, so show the new results without the user touching the filters.
  const wasScanActive = useRef(mediaInfoScanActive);
  useEffect(() => {
    const scanFinished = wasScanActive.current && !mediaInfoScanActive;
    wasScanActive.current = mediaInfoScanActive;
    if (scanFinished && detailsFilterActive) rerunCurrentSearch();
  }, [mediaInfoScanActive, detailsFilterActive, rerunCurrentSearch]);
  const selectedVideoGroup = useMemo(
    () => (selectedVideoPath ? videoGroups.find(group => group.path === selectedVideoPath) || null : null),
    [selectedVideoPath, videoGroups]
  );
  // The pictures the lightbox steps through, in display order: the frames of the open video group, else the images.
  const lightboxItems = useMemo(
    () => (selectedVideoGroup ? selectedVideoGroup.frames : imageResults),
    [selectedVideoGroup, imageResults]
  );
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
    replicaModelId: replica?.model_id ?? null,
    onSwitchStart: () => {
      setShowSettings(false);
      resetSearch();
    }
  });
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useFileDrop({
    enabled: Boolean(models.active_model),
    setToast,
    onFolders: queue.enqueueFolderIndexing,
    onImage: handleImageDrop,
    readOnly
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
    onIndexChanged: refreshSearch,
    readOnly
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
  const showNoMatches = results.length === 0 && !isSearching && hasSearched && Boolean(models.active_model) && !isSwitchingModel && (query.length > 0 || Boolean(imageSearchContext) || isBrowsing);

  const handleOpenFolder = async () => {
    // Folders are indexed on the computer the copy came from.
    if (readOnly) return;
    if (!window.electronAPI) {
      if (mode === 'network' && isOwner) setShowFolderPicker(true);
      return;
    }
    const paths = await window.electronAPI.openDirectory();
    if (paths && paths.length > 0) {
      await queue.enqueueFolderIndexing(paths);
    }
  };

  const handleClearCache = async () => {
    if (!models.active_model || readOnly) return;

    setIsClearing(true);
    try {
      const res = await apiFetch(`${API_BASE}/index/clear`, {
        method: 'POST'
      });
      // An old tab or a race: the backend refused, so nothing was cleared.
      if (res?.status === 409 && isReadOnlyRefusal(await readRefusalBody(res))) {
        setToast({ message: readOnlyMessage(), type: 'error' });
        return;
      }
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

  const content = (
    <div
      className={cn(
        "isolate h-dvh w-full overflow-y-auto overflow-x-hidden font-sans flex flex-col items-center relative px-safe custom-scrollbar",
        // A browser has no title bar, so no room for one; it keeps out of a phone's notch instead.
        mode === 'network' ? "pt-safe" : "pt-8",
        uiTheme === 'terminal' ? "terminal-theme theme-terminal" : "theme-modern bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* The window bar of the Windows app (and the dev page). A browser has none: the header has a menu instead. */}
      {mode !== 'network' && (
        <TitleBar
          theme={theme}
          setTheme={setTheme}
          uiTheme={uiTheme}
          setUiTheme={setUiTheme}
          sharingRunning={Boolean(status.sharing?.running)}
          sharingProblem={status.sharing?.problem ?? null}
          onOpenSharing={openSharingSettings}
        />
      )}

      {/* Drag Overlay */}
      {isDragging && <DragOverlay activeTask={queue.activeTask} pendingCount={queue.pendingCount} />}

      {/* Settings Modal */}
      <SettingsModal
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        openRequest={settingsRequest}
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
        minSimilarity={minSimilarity}
        setMinSimilarity={setMinSimilarity}
        maxResults={maxResults}
        setMaxResults={setMaxResults}
        resetSearchTuning={resetSearchTuning}
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
        setToast={setToast}
      />

      {showFolderPicker && !readOnly && (
        <FolderPickerModal uiTheme={uiTheme} onClose={closeFolderPicker} onConfirm={queue.enqueueFolderIndexing} />
      )}

      {/* Folder Contents Modal */}
      <FolderContentsModal showFolderContents={showFolderContents} browsingFolder={browsingFolder} folderContents={folderContents} isFetchingFolderContents={isFetchingFolderContents} isCleaningGhostRecords={isCleaningGhostRecords} setIsCleaningGhostRecords={setIsCleaningGhostRecords} folderVisibleLimit={folderVisibleLimit} setFolderVisibleLimit={setFolderVisibleLimit} handleCloseFolderContents={handleCloseFolderContents} handleReindexFolder={handleReindexFolder} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} />

      {/* Header */}
      <AppHeader models={models} openSettings={openSettings} queue={queue} uiTheme={uiTheme} handleSearch={handleSearch} isSearching={isSearching} searchInputRef={searchInputRef} query={query} setQuery={setQuery} activeFilterCount={activeFilterCount} filtersOpen={searchFilters.isOpen} onToggleFilters={searchFilters.toggleOpen} hasSearchResults={results.length > 0 || hasSearched} onClearSearch={handleCloseSearchResults} onPickImage={handleImageDrop} theme={theme} setTheme={setTheme} setUiTheme={setUiTheme} />

      {/* A browser on plain HTTP: its password and pictures are readable on the network */}
      <HttpWarningBanner />

      {/* Search filters panel (floats under the header) */}
      <SearchFiltersPanel filters={searchFilters} indexedFolders={indexedFolders} />

      {/* Global Status Bar */}
      <IndexingStatusBar status={status} queue={queue} setToast={setToast} openSettings={openSettings} isCancellingIndexing={isCancellingIndexing} handleCancelIndexing={handleCancelIndexing} />

      {/* Indexing Errors Alert */}
      <IndexingErrorsAlert showErrorAlert={showErrorAlert} setShowErrorAlert={setShowErrorAlert} status={status} />

      <ModelLoadErrorBanner modelLoadError={modelLoadError} setModelLoadError={setModelLoadError} status={status} pendingModel={pendingModel} setPendingModel={setPendingModel} handleDownloadModel={handleDownloadModel} />

      <ModelDownloadBanner status={status} pendingModel={pendingModel} handleCancelDownload={handleCancelDownload} />

      {/* Returned video frames grouped by their source video */}
      <VideoGroupModal selectedVideoGroup={selectedVideoGroup} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} onFindMoreFrames={expandVideo} isFindingMoreFrames={Boolean(selectedVideoPath) && expandingVideoPath === selectedVideoPath} canFindMoreFrames={canExpandVideos} />

      {/* Lightbox Modal */}
      <MediaLightbox selectedImage={selectedImage} setSelectedImage={setSelectedImage} setToast={setToast} uiTheme={uiTheme} navItems={lightboxItems} />

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
      <main className="w-full max-w-7xl px-4 sm:px-6 pb-24 flex-1">
        <ImageSearchChip imageSearchContext={imageSearchContext} handleClearImageSearch={handleClearImageSearch} />

        {/* In Terminal theme the chips live in the results console while it is open */}
        {(uiTheme !== 'terminal' || !(showSearchResults && results.length > 0)) && <ActiveFilterChips chips={filterChips} onClearAll={clearFilters} className="mb-6" />}

        {showNoMatches && <NoMatches browsing={isBrowsing} filtersActive={activeFilterCount > 0} onClearFilters={clearFilters} missingDetails={detailsFilterActive ? missingDetails : 0} scanActive={mediaInfoScanActive} onReadDetails={readDetailsNow} />}

        {(!backendReady || isSwitchingModel) && !status.is_downloading && <BackendLoading isSwitchingModel={isSwitchingModel} />}

        {backendReady && !isSwitchingModel && !models.active_model && !status.is_downloading && results.length === 0 && <ModelSetupState models={models} handleModelSwitch={handleModelSwitch} openSettings={openSettings} handleDownloadModel={handleDownloadModel} pendingModel={pendingModel} />}

        {models.active_model && !isSearching && query.length === 0 && results.length === 0 && !isSwitchingModel && !showNoMatches && <ReadyToSearch uiTheme={uiTheme} indexedFolders={indexedFolders} models={models} openSettings={openSettings} handleUnloadModel={handleUnloadModel} isUnloadingModel={isUnloadingModel} status={status} />}

        {/* In-page results grid for Modern theme */}
        <SearchResultsGrid results={results} uiTheme={uiTheme} videoGroups={videoGroups} imageResults={imageResults} visibleImageResults={visibleImageResults} visibleResultsCount={visibleResultsCount} setVisibleResultsCount={setVisibleResultsCount} sentinelRef={sentinelRef} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} isBrowsing={isBrowsing} browseSort={browseSort} onBrowseSortChange={setBrowseSort} browseTotal={browseTotal} showBrowseHint={showBrowseHint} onDismissBrowseHint={dismissBrowseHint} />

        {/* Terminal Modal Console for Terminal theme */}
        <TerminalResultsModal showSearchResults={showSearchResults} results={results} uiTheme={uiTheme} handleCloseSearchResults={handleCloseSearchResults} imageSearchContext={imageSearchContext} query={query} videoGroups={videoGroups} imageResults={imageResults} visibleImageResults={visibleImageResults} visibleResultsCount={visibleResultsCount} setVisibleResultsCount={setVisibleResultsCount} sentinelTerminalRef={sentinelTerminalRef} setSelectedVideoGroup={setSelectedVideoGroup} setSelectedImage={setSelectedImage} filterChips={filterChips} onClearFilters={clearFilters} activeFilterCount={activeFilterCount} filtersOpen={searchFilters.isOpen} onToggleFilters={searchFilters.toggleOpen} isBrowsing={isBrowsing} browseSort={browseSort} onBrowseSortChange={setBrowseSort} browseTotal={browseTotal} showBrowseHint={showBrowseHint} onDismissBrowseHint={dismissBrowseHint} />
      </main>

      {/* Background Task Queue Drawer (owner only: a viewer has no queue) */}
      {isOwner && (
        <QueueDrawer
          isOpen={queue.isDrawerOpen}
          onClose={() => queue.setIsDrawerOpen(false)}
          queue={queue}
          uiTheme={uiTheme}
          onOpenSettings={openSettings}
        />
      )}

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

  // The components below read whether the library is a read-only copy from here (useReplica)
  return <ReplicaContext.Provider value={replicaInfo}>{content}</ReplicaContext.Provider>;
}

export default App;
