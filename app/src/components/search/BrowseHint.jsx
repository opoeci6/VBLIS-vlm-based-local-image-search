import { Library, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// A slim line under the "Library" header while the library is shown without a query. Closed with its x.
export const BrowseHint = ({ onDismiss, className = '' }) => {
  const { t } = useTranslation('search');
  return (
  <div
    role="status"
    className={`flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/80 py-0 pl-3 pr-1 text-xs sm:px-3 sm:py-1.5 font-medium text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 ${className}`.trim()}
  >
    <Library className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1 py-1.5 sm:py-0">
      {t('browse.hint.text')}
    </span>
    <button
      type="button"
      onClick={onDismiss}
      aria-label={t('browse.hint.close')}
      title={t('browse.hint.close')}
      className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-indigo-100 sm:h-auto sm:w-auto sm:p-0.5 dark:hover:bg-indigo-500/20"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  </div>
  );
};
