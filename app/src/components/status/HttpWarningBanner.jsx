import { useState } from 'react';
import { ShieldAlert, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useSession } from '../../session/sessionContext';
import { readJson, writeJson } from '../../utils/storage';

export const HTTP_WARNING_DISMISSED_KEY = 'http_warning_dismissed';

// A slim warning for a signed-in browser on a plain HTTP connection. Closing it is remembered in this
// browser. The owner gets the ways to turn HTTPS on, a viewer is told to ask the owner.
export function HttpWarningBanner() {
  const { t } = useTranslation('session');
  const { mode, secure, isOwner } = useSession();
  const [dismissed, setDismissed] = useState(() => readJson(HTTP_WARNING_DISMISSED_KEY, false) === true);
  const [expanded, setExpanded] = useState(false);
  if (mode !== 'network' || secure || dismissed) return null;

  const dismiss = () => {
    writeJson(HTTP_WARNING_DISMISSED_KEY, true);
    setDismissed(true);
  };

  return (
    <div className="w-full max-w-7xl px-4 sm:px-6 mb-3" role="alert">
      <div className="border border-amber-300 dark:border-amber-500/30 bg-amber-50/90 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 rounded-2xl px-4 py-2.5 text-xs font-medium">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>{t('httpBanner.message')}</p>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="-my-2 sm:my-0 sm:mt-1 min-h-[40px] sm:min-h-0 inline-flex items-center gap-1 font-bold underline underline-offset-2 cursor-pointer"
            >
              {expanded ? t('httpBanner.hideHowTo') : t('httpBanner.howTo')}
              {expanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
            {expanded && (isOwner ? (
              <div className="mt-2 space-y-1">
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <Trans t={t} i18nKey="httpBanner.ownerSelfSigned" components={{ code: <code className="font-mono font-semibold" /> }} />
                  </li>
                  <li>{t('httpBanner.ownerFiles')}</li>
                  <li>{t('httpBanner.ownerProxy')}</li>
                </ul>
                <p>{t('httpBanner.ownerDocs')}</p>
              </div>
            ) : (
              <p className="mt-2">{t('httpBanner.viewerAsk')}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={dismiss}
            title={t('httpBanner.dismiss')}
            aria-label={t('httpBanner.dismiss')}
            className="p-3 -m-2.5 sm:m-0 sm:p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-500/20 flex-shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
