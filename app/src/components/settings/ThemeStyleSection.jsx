import { Sparkles, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { SectionTitle } from './SectionTitle';

export const ThemeStyleSection = ({ uiTheme, setUiTheme }) => {
  const { t } = useTranslation('settings');
  return (
    <div>
      <SectionTitle className="mb-3">{t('theme.title')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {/* aria-pressed also gives the chosen style the terminal theme's inverted look (index.css) */}
        <button
          type="button"
          aria-pressed={uiTheme === 'modern'}
          onClick={() => setUiTheme('modern')}
          className={cn(
            "flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all",
            uiTheme === 'modern'
              ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20"
              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
          )}
        >
          <Sparkles className={cn("w-5 h-5 flex-shrink-0", uiTheme === 'modern' ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400")} />
          <div className="min-w-0">
            <div className="text-xs font-bold">{t('theme.modern.name')}</div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{t('theme.modern.desc')}</div>
          </div>
        </button>
        <button
          type="button"
          aria-pressed={uiTheme === 'terminal'}
          onClick={() => setUiTheme('terminal')}
          className={cn(
            "flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all",
            uiTheme === 'terminal'
              ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20"
              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
          )}
        >
          <Terminal className={cn("w-5 h-5 flex-shrink-0", uiTheme === 'terminal' ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400")} />
          <div className="min-w-0">
            <div className="text-xs font-bold">{t('theme.terminal.name')}</div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{t('theme.terminal.desc')}</div>
          </div>
        </button>
      </div>
    </div>
  );
};
