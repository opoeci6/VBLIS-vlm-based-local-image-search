import { cn } from '../../utils/cn';

const OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

// Two buttons that choose the sort order of the library view. `variant` only changes the look.
export const BrowseSortToggle = ({ sort, onChange, variant = 'modern', className }) => (
  <div role="group" aria-label="Sort order" className={cn('inline-flex flex-shrink-0 items-center', variant === 'modern' ? 'gap-1 rounded-xl bg-gray-100 p-1 dark:bg-neutral-800' : 'gap-2', className)}>
    {OPTIONS.map(option => (
      <button
        key={option.value}
        type="button"
        aria-pressed={sort === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          'cursor-pointer px-3 py-1.5 text-xs font-bold transition-all',
          variant === 'modern'
            ? cn(
              'rounded-lg',
              sort === option.value
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-neutral-700 dark:text-indigo-300'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            )
            : 'border border-white uppercase'
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
