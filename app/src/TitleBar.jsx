import { Minus, Square, X, Moon, Sun, Radio, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from './session/sessionContext';
import { ThemeStyleMenu } from './components/layout/ThemeStyle';

// The bar of the Windows app (and the dev page). A browser has none: its theme, account and Sign out controls
// are in the header menu (components/layout/HeaderMenu.jsx).
// `sharingRunning` and `sharingProblem` (the problem code, or null) come from the status poll of the Windows app:
// while it shares, a pill says so; while it should share but cannot, an amber one does. Clicking opens the
// sharing settings through `onOpenSharing`.
const TitleBar = ({ theme, setTheme, uiTheme = 'modern', setUiTheme, sharingRunning = false, sharingProblem = null, onOpenSharing }) => {
  const { t } = useTranslation('settings');
  const { mode } = useSession();
  const showSharingPill = mode === 'desktop' && (sharingRunning || Boolean(sharingProblem));
  // The window buttons and the drag region belong to the Electron window.
  const hasWindowControls = Boolean(window.electronAPI);

  const handleMinimize = () => {
    window.electronAPI?.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.close();
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div data-testid="title-bar" className="h-8 w-full bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between select-none fixed top-0 left-0 z-[200]">
      <div className="flex-1 h-full flex items-center px-3" style={hasWindowControls ? { WebkitAppRegion: 'drag' } : undefined}>
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 tracking-tight">VBLIS</span>
      </div>
      <div className="flex h-full items-center" style={hasWindowControls ? { WebkitAppRegion: 'no-drag' } : undefined}>
        {showSharingPill && (
          <button
            type="button"
            onClick={onOpenSharing}
            title={sharingProblem ? t('titleBar.notSharingTooltip') : t('titleBar.sharingTooltip')}
            className={`mr-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold transition-colors ${
              sharingProblem
                ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/25'
                : 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/25'
            }`}
          >
            {sharingProblem ? <TriangleAlert className="w-3 h-3" aria-hidden="true" /> : <Radio className="w-3 h-3" aria-hidden="true" />}
            {sharingProblem ? t('titleBar.notSharing') : t('titleBar.sharing')}
          </button>
        )}
        <ThemeStyleMenu
          uiTheme={uiTheme}
          setUiTheme={setUiTheme}
          wrapperClassName="relative h-full"
          triggerClassName="h-full px-3.5 flex items-center justify-center text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-indigo-400 transition-colors"
        />
        <div className="w-[1px] h-4 bg-gray-200 dark:bg-neutral-800 mx-1" />
        <button
          onClick={toggleTheme}
          className="h-full px-3.5 flex items-center justify-center text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-amber-400 transition-colors"
          title={theme === 'dark' ? t('titleBar.switchToLight') : t('titleBar.switchToDark')}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        {hasWindowControls && (
          <>
            <div className="w-[1px] h-4 bg-gray-200 dark:bg-neutral-800 mx-1" />
            <button
              onClick={handleMinimize}
              className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors"
              title={t('titleBar.minimize')}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleMaximize}
              className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors"
              title={t('titleBar.maximize')}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={handleClose}
              className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-rose-600 hover:text-white dark:text-neutral-400 dark:hover:bg-rose-600 dark:hover:text-white transition-colors"
              title={t('common:close')}
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TitleBar;
