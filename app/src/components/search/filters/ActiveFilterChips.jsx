import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Pills for the active filters, each removable, plus "Clear all" when there are several.
export const ActiveFilterChips = ({ chips, onClearAll, className = '' }) => {
  const { t } = useTranslation('filters');
  if (!chips || chips.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label={t('activeChips.groupLabel')}>
      {chips.map(chip => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl text-xs font-semibold text-indigo-700 dark:text-indigo-300"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={t('activeChips.remove', { label: chip.label })}
            className="p-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {chips.length >= 2 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="px-2 py-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white underline cursor-pointer"
        >
          {t('activeChips.clearAll')}
        </button>
      )}
    </div>
  );
};
