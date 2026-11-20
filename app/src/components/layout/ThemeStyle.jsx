import { useRef, useState } from 'react';
import { Check, Shirt, Sparkles, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cn } from '../../utils/cn';
import { useOutsideClick } from './useOutsideClick';

// The UI style choice (Modern / Terminal), shared by the title bar, the header menu of a browser and the
// floating control of the sign-in screens, so all of them use the same options, texts and look.
export const ThemeStyleOptions = ({ uiTheme, onSelect }) => {
  const { t } = useTranslation('settings');
  const themeOptions = [
    { id: 'modern', label: t('theme.modern.name'), icon: Sparkles, desc: t('titleBar.themeOptions.modern.desc') },
    { id: 'terminal', label: t('theme.terminal.name'), icon: Terminal, desc: t('titleBar.themeOptions.terminal.desc') }
  ];

  return (
    <>
      <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {t('theme.title')}
      </div>
      <div className="space-y-1">
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          const isSelected = uiTheme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                'flex w-full min-h-[44px] sm:min-h-0 items-center justify-between gap-3 px-2.5 py-2 text-left rounded-lg transition-all',
                isSelected
                  ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-neutral-400')} />
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight">{opt.label}</div>
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-500 truncate leading-normal">{opt.desc}</div>
                </div>
              </div>
              {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />}
            </button>
          );
        })}
      </div>
    </>
  );
};

// A button with a shirt icon that opens the style options in a popover under it. It closes on an outside
// press, on Esc and after a choice. `triggerClassName` and `wrapperClassName` let each place style the button.
export const ThemeStyleMenu = ({ uiTheme, setUiTheme, triggerClassName, wrapperClassName = 'relative' }) => {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useOutsideClick(rootRef, open, () => setOpen(false));
  useEscapeKey(open, () => setOpen(false));

  return (
    <div ref={rootRef} className={wrapperClassName}>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={triggerClassName}
        title={t('titleBar.switchTheme')}
        aria-label={t('titleBar.switchTheme')}
        aria-expanded={open}
      >
        <Shirt className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[220] mt-1 w-64 max-w-[calc(100vw-1rem)] border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded-xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          <ThemeStyleOptions
            uiTheme={uiTheme}
            onSelect={(id) => {
              setUiTheme?.(id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
};
