import { cn } from '../../../utils/cn';

// One pressable option of the filters panel. The pressed look comes from aria-pressed; in the
// terminal theme index.css inverts every button[aria-pressed="true"].
export const FilterToggle = ({ pressed, onClick, children, className, ...rest }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer',
      pressed
        ? 'border-indigo-300 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200'
        : 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700',
      className
    )}
    {...rest}
  >
    {children}
  </button>
);
