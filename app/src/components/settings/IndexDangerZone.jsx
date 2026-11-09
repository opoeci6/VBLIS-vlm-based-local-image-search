import { Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const IndexDangerZone = ({ showConfirmClear, setShowConfirmClear, handleClearCache, isClearing, models }) => {
  const { t } = useTranslation('settings');
  return (
    <div className="pt-4 mt-6 border-t border-gray-100 dark:border-neutral-800">
      {showConfirmClear ? (
        <div className="p-4 bg-gray-50 dark:bg-neutral-950/50 border border-rose-200 dark:border-rose-500/30 rounded-xl space-y-3 animate-in zoom-in-95 duration-200">
          <p className="text-sm font-bold text-rose-600 dark:text-rose-300">{t('dangerZone.confirm')}</p>
          <div className="flex gap-2">
            <button onClick={handleClearCache} disabled={isClearing} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg py-2 text-sm font-bold flex justify-center items-center gap-2 transition-colors">
              {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isClearing ? t('dangerZone.deleting') : t('dangerZone.confirmDelete')}
            </button>
            <button onClick={() => setShowConfirmClear(false)} disabled={isClearing} className="flex-1 bg-gray-200 dark:bg-neutral-800 hover:bg-gray-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-2 text-sm font-bold transition-colors">{t('common:cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => setShowConfirmClear(true)}
            disabled={isClearing || !models.active_model}
            className="w-full px-4 py-3 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm border border-rose-200 dark:border-rose-500/20"
          >
            {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {isClearing ? t('dangerZone.clearing') : t('dangerZone.clear')}
          </button>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center mt-2 font-medium">{t('dangerZone.description')}</p>
        </>
      )}
    </div>
  );
};
