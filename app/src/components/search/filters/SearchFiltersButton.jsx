import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';

export const SearchFiltersButton = ({ activeCount = 0, isOpen = false, onToggle }) => {
  const { t } = useTranslation('filters');
  const label = activeCount > 0
    ? t('button.labelActive', { count: activeCount })
    : t('button.label');
  return (
    <button
      type="button"
      // Lets the filters panel tell a click on this button from an "outside" click.
      data-filters-toggle="true"
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={label}
      title={t('button.label')}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-3 border rounded-2xl transition-all active:scale-95 font-medium text-sm shadow-sm cursor-pointer',
        activeCount > 0 || isOpen
          ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300'
          : 'bg-white dark:bg-neutral-900/50 border-gray-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800'
      )}
    >
      <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
      <span>{t('button.text')}</span>
      {activeCount > 0 && (
        <span
          data-testid="filters-count"
          className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold"
        >
          {activeCount}
        </span>
      )}
    </button>
  );
};
