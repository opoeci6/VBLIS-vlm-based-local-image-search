import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThemeStyleMenu } from './ThemeStyle';

// What the sign-in, loading and connection-error screens have instead of the title bar: a small floating
// control at the top right to switch the style and light or dark. It keeps out of a phone's notch.
export const SessionThemeControl = ({ theme, setTheme, uiTheme, setUiTheme }) => {
  const { t } = useTranslation('settings');
  const toggleLabel = theme === 'dark' ? t('titleBar.switchToLight') : t('titleBar.switchToDark');
  const buttonClass = 'h-10 w-10 flex items-center justify-center rounded-xl text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-indigo-400 transition-colors cursor-pointer';
  return (
    <div className="fixed right-0 top-0 z-[200] pt-safe px-safe">
      <div className="m-2 flex items-center rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 backdrop-blur shadow-sm">
        <ThemeStyleMenu uiTheme={uiTheme} setUiTheme={setUiTheme} triggerClassName={buttonClass} />
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={buttonClass}
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
