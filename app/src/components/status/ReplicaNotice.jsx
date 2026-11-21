import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../session/sessionContext';
import { useReplica } from '../../session/replicaContext';
import { formatDate, formatNumber } from '../../utils/formatters';
import { cn } from '../../utils/cn';

// The owner's note that the library is a read-only copy of an index made on another computer: where it came
// from, when it was exported, and how many of its files are not on this computer. Nothing for a viewer
// (the backend sends them no details) or for an ordinary library.
export function ReplicaNotice({ className }) {
  const { t } = useTranslation('replica');
  const { isOwner } = useSession();
  const { replica } = useReplica();
  if (!isOwner || !replica) return null;

  const host = replica.source_host || null;
  const date = formatDate(replica.exported_at);
  const missing = Number(replica.missing) > 0 ? Number(replica.missing) : 0;

  return (
    <div
      role="note"
      data-testid="replica-notice"
      className={cn(
        'flex items-start gap-2.5 rounded-2xl border border-amber-300 dark:border-amber-500/30 bg-amber-50/90 dark:bg-amber-950/30 px-4 py-2.5 text-xs font-medium text-amber-900 dark:text-amber-200',
        className
      )}
    >
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          {/* Without a host the wording has its own strings: Chinese puts no spaces around 另一台电脑 */}
          {host
            ? (date ? t('notice.withDate', { host, date }) : t('notice.withoutDate', { host }))
            : (date ? t('notice.withDateNoHost', { date }) : t('notice.withoutDateNoHost'))}
        </p>
        {missing > 0 && <p>{t('notice.missing', { count: missing, formatted: formatNumber(missing) })}</p>}
      </div>
    </div>
  );
}
