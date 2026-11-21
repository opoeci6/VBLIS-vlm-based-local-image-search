import { useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServerSettings } from '../../hooks/useServerSettings';
import { cn } from '../../utils/cn';
import { AccountsModal } from './AccountsModal';
import { SectionTitle } from './SectionTitle';
import { Fact, cardClass, dangerButton, errorClass, secondaryButton } from './serverUi';

function SignOutOthers({ onSignOutOthers }) {
  const { t } = useTranslation('session');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const run = async () => {
    setIsWorking(true);
    await onSignOutOthers();
    setIsWorking(false);
    setIsConfirming(false);
  };

  if (!isConfirming) {
    return (
      <button type="button" onClick={() => setIsConfirming(true)} className={secondaryButton}>
        {t('server.signOutOthers.button')}
      </button>
    );
  }
  return (
    <div className={cn(cardClass, 'border-rose-200 dark:border-rose-500/30')}>
      <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{t('server.signOutOthers.confirm')}</p>
      <div className="flex gap-2">
        <button type="button" onClick={run} disabled={isWorking} className={dangerButton}>
          {isWorking && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {t('server.signOutOthers.submit')}
        </button>
        <button type="button" onClick={() => setIsConfirming(false)} disabled={isWorking} className={secondaryButton}>{t('common:cancel')}</button>
      </div>
    </div>
  );
}

const HTTPS_LABELS = { off: 'server.facts.httpsOff', self_signed: 'server.facts.httpsSelfSigned', files: 'server.facts.httpsFiles' };

// Settings of the network server, for the owner signed in from a browser.
// `showTitle` is false when the page it sits on already carries the title.
export function ServerSection({ uiTheme, setToast, showTitle = true }) {
  const { t } = useTranslation('session');
  const { settings, loadFailed, reload, signOutOtherBrowsers } = useServerSettings({ setToast });
  const [isManaging, setIsManaging] = useState(false);

  const roots = settings?.library_roots ?? [];
  const environment = settings?.from_environment ?? [];
  const httpsKey = HTTPS_LABELS[settings?.tls_mode];
  const counts = settings?.accounts;

  const closeAccounts = () => {
    setIsManaging(false);
    // The accounts may have changed: read the counts again.
    reload();
  };

  return (
    <div className="space-y-4">
      {showTitle && <SectionTitle>{t('server.title')}</SectionTitle>}

      {!settings ? (
        loadFailed ? (
          <p className={errorClass} role="alert">{t('server.loadFailed')}</p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-neutral-500" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {t('server.loading')}
          </p>
        )
      ) : (
        <>
          <div className={cardClass}>
            <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('server.accounts.title')}</h5>
            {counts && (
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                {t('server.accounts.summary', {
                  owners: t('server.accounts.owners', { count: counts.owners }),
                  viewers: t('server.accounts.viewers', { count: counts.viewers })
                })}
              </p>
            )}
            <button type="button" onClick={() => setIsManaging(true)} className={secondaryButton}>
              <Users className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              {t('server.accounts.manage')}
            </button>
          </div>

          <div className={cardClass}>
            <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('server.facts.title')}</h5>
            <Fact label={t('server.facts.libraryFolders')}>
              {roots.length === 0 ? t('server.facts.noLibraryFolders') : roots.map((root) => <span key={root} className="block">{root}</span>)}
            </Fact>
            {settings.port != null && <Fact label={t('server.facts.port')}>{settings.port}</Fact>}
            {httpsKey && <Fact label={t('server.facts.https')}>{t(httpsKey)}</Fact>}
            {settings.public_access != null && (
              <Fact label={t('server.facts.internet')}>
                {settings.public_access ? t('server.facts.internetOn') : t('server.facts.internetOff')}
              </Fact>
            )}
            {environment.length > 0 && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t('server.facts.fromEnvironment', { names: environment.join(', ') })}</p>
            )}
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{t('server.facts.hint')}</p>
          </div>
        </>
      )}

      <SignOutOthers onSignOutOthers={signOutOtherBrowsers} />

      {isManaging && <AccountsModal uiTheme={uiTheme} setToast={setToast} onClose={closeAccounts} />}
    </div>
  );
}
