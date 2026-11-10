import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

const OPTIONS = ['newest', 'oldest'];

// Two buttons that choose the sort order of the library view. `variant` only changes the look.
export const BrowseSortToggle = ({ sort, onChange, variant = 'modern', className }) => {
  const { t } = useTranslation('search');
  const labels = { newest: t('browse.sort.newest'), oldest: t('browse.sort.oldest') };
  return (
  <div role="group" aria-label={t('browse.sort.label')} className={cn('inline-flex flex-shrink-0 items-center', variant === 'modern' ? 'gap-1 rounded-xl bg-gray-100 p-1 dark:bg-neutral-800' : 'gap-2', className)}>
    {OPTIONS.map(option => (
      <button
        key={option}
        type="button"
        aria-pressed={sort === option}
        onClick={() => onChange(option)}
        className={cn(
          'cursor-pointer px-3 py-1.5 text-xs font-bold transition-all',
          variant === 'modern'
            ? cn(
              'rounded-lg',
              sort === option
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-neutral-700 dark:text-indigo-300'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            )
            : 'border border-white uppercase'
        )}
      >
        {labels[option]}
      </button>
    ))}
  </div>
  );
};
