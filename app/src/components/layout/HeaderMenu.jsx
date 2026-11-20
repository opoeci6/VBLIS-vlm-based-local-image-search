import { useRef, useState } from 'react';
import { LogOut, Moon, Sun, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useSession } from '../../session/sessionContext';
import { ThemeStyleOptions } from './ThemeStyle';
import { useOutsideClick } from './useOutsideClick';

// In a browser there is no title bar, so its controls live here: one button in the header that opens the
// style choice, light or dark, who is signed in, and Sign out. It closes on an outside press, on Esc and
// after a choice.
export const HeaderMenu = ({ theme, setTheme, uiTheme, setUiTheme }) => {
  const { t } = useTranslation('session');
  const { role, account, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = () => setOpen(false);
  useOutsideClick(rootRef, open, close);
  useEscapeKey(open, close);

  const roleLabel = role === 'owner' ? t('role.owner') : t('role.viewer');
  const signedInLabel = account ? t('signedInAs', { name: account.name, role: roleLabel }) : roleLabel;
  const toggleLabel = theme === 'dark' ? t('settings:titleBar.switchToLight') : t('settings:titleBar.switchToDark');
  const rowClass = 'flex w-full min-h-[44px] sm:min-h-0 items-center gap-2.5 px-2.5 py-2 text-left text-xs font-bold rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-label={t('headerMenu.label')}
        aria-haspopup="true"
        aria-expanded={open}
        title={signedInLabel}
        className="flex items-center gap-2 h-10 min-w-[40px] justify-center px-2.5 sm:px-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all active:scale-95 text-neutral-500 hover:text-neutral-900 dark:hover:text-white shadow-sm dark:shadow-none cursor-pointer"
      >
        <User className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        {account && <span className="hidden sm:inline max-w-[8rem] truncate text-xs font-semibold">{account.name}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-64 max-w-[calc(100vw-2rem)] border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 rounded-xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          <ThemeStyleOptions
            uiTheme={uiTheme}
            onSelect={(id) => {
              setUiTheme?.(id);
              close();
            }}
          />
          <div className="my-1.5 border-t border-gray-200 dark:border-neutral-800" />
          <button
            type="button"
            onClick={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark');
              close();
            }}
            className={rowClass}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> : <Moon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{toggleLabel}</span>
          </button>
          <div className="my-1.5 border-t border-gray-200 dark:border-neutral-800" />
          <p className="px-2.5 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 break-words">{signedInLabel}</p>
          <button
            type="button"
            onClick={() => {
              close();
              signOut();
            }}
            className={rowClass}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>{t('signOut')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
