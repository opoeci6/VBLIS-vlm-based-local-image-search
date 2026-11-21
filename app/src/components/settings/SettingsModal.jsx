import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Settings, X } from 'lucide-react';
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
import { ExportSection } from './ExportSection';
import { AccountSection } from './AccountSection';
import { SETTINGS_GROUP_STORAGE_KEY, visibleSettingsGroups } from './settingsGroups';
import { ReplicaNotice } from '../status/ReplicaNotice';
import { useSession } from '../../session/sessionContext';
import { useReplica } from '../../session/replicaContext';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cn } from '../../utils/cn';
import { readJson, writeJson } from '../../utils/storage';

// A one-shot read of the screen width (Tailwind's `md`): only used when a request opens a group, to decide
// whether a phone should land on that group's page. Not subscribed to: resizing later changes nothing here.
const isWideScreen = () => {
  try {
    return window.matchMedia?.('(min-width: 768px)')?.matches === true;
  } catch {
    return false;
  }
};

// Section titles come from the sections themselves; each section sits in a wrapper that owns the spacing and
// the divider (the wrapper of a section that renders nothing, like ReplicaNotice, is empty and hidden).
const SectionWrapper = ({ children }) => (
  <div className="py-6 first:pt-0 last:pb-0 empty:hidden">{children}</div>
);

export const SettingsModal = ({ showSettings, setShowSettings, uiTheme, setUiTheme, gpuSettings, status, isSwitchingGpu, handleToggleGpu, handleUpdatePerformanceSettings, models, pendingModel, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel, minScore, setMinScore, minSimilarity, setMinSimilarity, maxResults, setMaxResults, resetSearchTuning, showConfirmClear, setShowConfirmClear, handleClearCache, isClearing, cacheStats, showConfirmClearThumbnails, setShowConfirmClearThumbnails, handleClearThumbnailCache, isClearingThumbnails, handleRebuildVideoThumbnails, isTriggeringRebuildThumbnails, setToast, openRequest }) => {
  const { t } = useTranslation('settings');
  // A viewer only gets the groups that are about their own browser: appearance, search and their account.
  const { isOwner, mode } = useSession();
  // On a read-only copy of an index made elsewhere the index can't be cleared.
  const { readOnly } = useReplica();
  const groups = visibleSettingsGroups({ isOwner, mode });
  const isVisible = (id) => groups.some((item) => item.id === id);

  // The group to show: the one asked for, else the one used last, else the first. Anything not visible to this
  // session (or garbage in storage) is skipped.
  const resolveGroup = (requested) => {
    if (typeof requested === 'string' && isVisible(requested)) return requested;
    const remembered = readJson(SETTINGS_GROUP_STORAGE_KEY, null);
    if (typeof remembered === 'string' && isVisible(remembered)) return remembered;
    return groups[0].id;
  };

  // A phone lands right on the page of a group it was asked for, when that group is there for this session (a
  // viewer's click on the model pill asks for Models, which a viewer doesn't have: they get the list instead).
  const opensPage = (request) => isVisible(request?.group) && !isWideScreen();

  const [group, setGroup] = useState(() => resolveGroup(openRequest?.group));
  // Below `md` the window shows either the list of groups or one group's page.
  const [pageOpen, setPageOpen] = useState(() => opensPage(openRequest));
  // A new request object (App makes one per open call) is a new request, even for the same group. It is
  // applied while rendering, so the window never shows the old group for a frame.
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest);
    if (openRequest) {
      setGroup(resolveGroup(openRequest.group));
      setPageOpen(opensPage(openRequest));
    }
  }
  // The session can change under an open window (a sign-out): a group that went away falls back.
  const activeId = isVisible(group) ? group : resolveGroup(null);
  const activeGroup = groups.find((item) => item.id === activeId);

  // Remembered so that the gear opens on the group used last.
  useEffect(() => {
    if (showSettings) writeJson(SETTINGS_GROUP_STORAGE_KEY, activeId);
  }, [showSettings, activeId]);

  const tabRefs = useRef({});

  const close = () => setShowSettings(false);
  // An inline confirmation (clear index, delete a model, clear thumbnails) belongs to its page: leaving the
  // page cancels it.
  const clearConfirmations = () => {
    if (showConfirmClear) setShowConfirmClear(false);
    if (showConfirmDeleteModel) setShowConfirmDeleteModel(null);
    if (showConfirmClearThumbnails) setShowConfirmClearThumbnails(null);
  };
  const selectGroup = (id) => {
    if (id === activeId) return;
    clearConfirmations();
    setGroup(id);
  };
  const openPage = (id) => {
    selectGroup(id);
    setPageOpen(true);
  };
  const backToList = () => {
    clearConfirmations();
    setPageOpen(false);
  };

  // Esc first cancels an open inline confirmation, then goes back from a phone page to the list, then closes.
  const cancelOpenConfirmation = () => {
    if (showConfirmClear) setShowConfirmClear(false);
    else if (showConfirmDeleteModel) setShowConfirmDeleteModel(null);
    else if (showConfirmClearThumbnails) setShowConfirmClearThumbnails(null);
    else return false;
    return true;
  };
  useEscapeKey(showSettings, () => {
    if (cancelOpenConfirmation()) return;
    if (pageOpen) backToList();
    else close();
  });
  // Back in a phone browser: Settings holds one history entry, an open page a second one on top of it.
  useBackToClose(showSettings, close);
  useBackToClose(showSettings && pageOpen, backToList);
  const backdropDismiss = useBackdropDismiss(close);
  if (!(showSettings)) return null;

  // Up/Down move between the tabs (wrapping), Home/End jump; the selection follows the focus.
  const onTabKeyDown = (event) => {
    const count = groups.length;
    const index = groups.findIndex((item) => item.id === activeId);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % count;
    else if (event.key === 'ArrowUp') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    const id = groups[next].id;
    selectGroup(id);
    tabRefs.current[id]?.focus();
  };

  // The sections of a group, in order, each in its wrapper: the ones this session may not see are left out.
  const sectionsOf = (id) => {
    switch (id) {
      case 'appearance':
        return [
          <SectionWrapper key="theme"><ThemeStyleSection uiTheme={uiTheme} setUiTheme={setUiTheme} /></SectionWrapper>,
          <SectionWrapper key="language"><LanguageSection /></SectionWrapper>,
        ];
      case 'search':
        return [
          <SectionWrapper key="tuning">
            <SearchTuningSection
              minScore={minScore}
              setMinScore={setMinScore}
              minSimilarity={minSimilarity}
              setMinSimilarity={setMinSimilarity}
              maxResults={maxResults}
              setMaxResults={setMaxResults}
              resetSearchTuning={resetSearchTuning}
            />
          </SectionWrapper>,
        ];
      case 'models':
        return [
          <SectionWrapper key="performance">
            <PerformanceSection
              gpuSettings={gpuSettings}
              status={status}
              uiTheme={uiTheme}
              isSwitchingGpu={isSwitchingGpu}
              handleToggleGpu={handleToggleGpu}
              handleUpdatePerformanceSettings={handleUpdatePerformanceSettings}
            />
          </SectionWrapper>,
          <SectionWrapper key="models">
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
          </SectionWrapper>,
        ];
      case 'library':
        return [
          <SectionWrapper key="thumbnails">
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
          </SectionWrapper>,
          // Copying the index to another device: the Windows app's owner only
          mode === 'desktop' && isOwner && (
            <SectionWrapper key="export"><ExportSection uiTheme={uiTheme} setToast={setToast} /></SectionWrapper>
          ),
          // The library is a read-only copy: says where from (nothing otherwise, and then the wrapper stays
          // empty and hidden). A copy can still be exported on.
          <SectionWrapper key="replica"><ReplicaNotice /></SectionWrapper>,
          !readOnly && (
            <SectionWrapper key="danger">
              <IndexDangerZone
                showConfirmClear={showConfirmClear}
                setShowConfirmClear={setShowConfirmClear}
                handleClearCache={handleClearCache}
                isClearing={isClearing}
                models={models}
              />
            </SectionWrapper>
          ),
        ];
      case 'sharing':
        // Sharing from the Windows app: the desktop's only owner turns it on and manages its accounts here
        return [<SectionWrapper key="sharing"><SharingSection uiTheme={uiTheme} setToast={setToast} showTitle={false} /></SectionWrapper>];
      case 'server':
        // The network server's own settings: its owner changes them from a browser
        return [<SectionWrapper key="server"><ServerSection uiTheme={uiTheme} setToast={setToast} showTitle={false} /></SectionWrapper>];
      case 'account':
        // Who is signed in from a browser: any role changes its own password here
        return [<SectionWrapper key="account"><AccountSection uiTheme={uiTheme} setToast={setToast} showTitle={false} /></SectionWrapper>];
      default:
        return [];
    }
  };

  const activeTitle = activeGroup.title(t, { isOwner, mode });
  const rowIcon = 'w-5 h-5 flex-shrink-0';

  return (
    <div
      className={cn(
        'app-overlay fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm sm:items-center sm:p-4',
        // The Windows app's title bar (32 px, always on top) would cover the header of a narrow window: start below it.
        mode !== 'network' && 'top-8'
      )}
      data-settings-backdrop="true"
      {...backdropDismiss}
    >
      <div className="relative flex flex-col md:flex-row overflow-hidden max-w-full max-h-full animate-in fade-in zoom-in-95 duration-200 bg-white dark:bg-neutral-900 shadow-2xl w-full h-dvh pt-safe pb-safe px-safe sm:w-[480px] sm:h-[min(40rem,90dvh)] sm:rounded-2xl sm:border sm:p-0 border-gray-200 dark:border-neutral-800 md:w-[min(820px,calc(100vw-2rem))] md:h-[min(42rem,90dvh)]">
        <button
          type="button"
          onClick={close}
          className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] sm:top-3 sm:right-3 z-10 flex h-10 w-10 items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
          title={t('settingsModal.closeTooltip')}
          aria-label={t('settingsModal.closeTooltip')}
        >
          <X className="w-5 h-5" />
        </button>

        <nav
          className={cn(
            'flex-col min-h-0 flex-1 md:flex-none md:w-56 md:shrink-0 md:border-r border-gray-200 dark:border-neutral-800 overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-4',
            pageOpen ? 'hidden md:flex' : 'flex'
          )}
        >
          <h2 className="text-xl font-bold mb-4 pr-12 md:pr-0 flex items-center gap-2 text-neutral-900 dark:text-white">
            <Settings className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> {t('settingsModal.title')}
          </h2>

          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label={t('settingsModal.groupsLabel')}
            className="hidden md:flex flex-col gap-1"
          >
            {groups.map((item) => {
              const selected = item.id === activeId;
              return (
                <button
                  key={item.id}
                  ref={(element) => { tabRefs.current[item.id] = element; }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls="settings-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectGroup(item.id)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                    selected
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white'
                  )}
                >
                  <item.Icon className={rowIcon} aria-hidden="true" />
                  {item.title(t, { isOwner, mode })}
                </button>
              );
            })}
          </div>

          <div className="md:hidden flex flex-col gap-1">
            {groups.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openPage(item.id)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
              >
                <item.Icon className={cn(rowIcon, 'text-indigo-500 dark:text-indigo-400')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-neutral-900 dark:text-white">{item.title(t, { isOwner, mode })}</span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">{item.description(t, { isOwner, mode })}</span>
                </span>
                <ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400" aria-hidden="true" />
              </button>
            ))}
          </div>
        </nav>

        <div
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${activeId}`}
          className={cn('flex-1 min-w-0 min-h-0 flex-col', pageOpen ? 'flex' : 'hidden md:flex')}
        >
          <div className="flex min-h-14 flex-shrink-0 items-center gap-2 border-b border-gray-100 dark:border-neutral-800 pl-3 pr-14 sm:pl-5 md:pl-6">
            <button
              type="button"
              onClick={backToList}
              className="md:hidden flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
              aria-label={t('settingsModal.back')}
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">{activeTitle}</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6">
            <div className="divide-y divide-gray-100 dark:divide-neutral-800">
              {sectionsOf(activeId)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
