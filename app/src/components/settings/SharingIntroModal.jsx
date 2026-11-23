import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { writeJson } from '../../utils/storage';
import { DialogIcon, SharingDialog } from './SharingDialog';
import { HTTP_WARNING_OFF_KEY, HttpWarningBody } from './HttpSharingWarningModal';
import { dangerButton, primaryButton, secondaryButton } from './serverUi';

export const SHARING_INTRO_SEEN_KEY = 'sharing_intro_seen';

// The plain-language pop-up the first time sharing is turned on on this computer. `variant`:
//   'self_signed'  the new default: encrypted, but each browser warns once about the certificate
//   'files'        the owner's own certificate: no warning to expect
//   'off'          plain HTTP: the same text as the HTTP warning, with the choice to use HTTPS instead
// Confirming (any button but Cancel) marks it seen, so it never shows again. `onTurnOn`, `onUseHttps` and
// `onShareAnyway` start sharing; `onCancel` sends nothing and leaves it unseen.
export function SharingIntroModal({ variant, uiTheme, isBusy, onTurnOn, onUseHttps, onShareAnyway, onCancel }) {
  const { t } = useTranslation('settings');
  const [dontWarn, setDontWarn] = useState(false);
  const isOff = variant === 'off';

  const confirm = (action) => () => {
    writeJson(SHARING_INTRO_SEEN_KEY, true);
    if (isOff && dontWarn) writeJson(HTTP_WARNING_OFF_KEY, true);
    action();
  };

  const buttons = isOff ? (
    <>
      <button type="button" onClick={confirm(onUseHttps)} disabled={isBusy} className={primaryButton}>{t('sharing.httpWarning.useHttps')}</button>
      <button type="button" onClick={confirm(onShareAnyway)} disabled={isBusy} className={dangerButton}>{t('sharing.httpWarning.shareAnyway')}</button>
      <button type="button" onClick={onCancel} disabled={isBusy} className={secondaryButton}>{t('common:cancel')}</button>
    </>
  ) : (
    <>
      <button type="button" onClick={confirm(onTurnOn)} disabled={isBusy} className={primaryButton}>{t('sharing.intro.turnOn')}</button>
      <button type="button" onClick={onCancel} disabled={isBusy} className={secondaryButton}>{t('common:cancel')}</button>
    </>
  );

  return (
    <SharingDialog
      uiTheme={uiTheme}
      title={t('sharing.intro.title')}
      icon={<DialogIcon tone="info"><Share2 className="w-5 h-5" aria-hidden="true" /></DialogIcon>}
      onCancel={onCancel}
      buttons={buttons}
    >
      <p>{t('sharing.intro.lead')}</p>
      {isOff ? (
        <HttpWarningBody dontWarn={dontWarn} onDontWarnChange={setDontWarn} disabled={isBusy} />
      ) : (
        <>
          {variant === 'self_signed' && (
            <>
              <p className="font-semibold text-neutral-800 dark:text-neutral-200">{t('sharing.intro.warningTitle')}</p>
              <p>{t('sharing.intro.warningBody')}</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>{t('sharing.intro.chrome')}</li>
                <li>{t('sharing.intro.safari')}</li>
                <li>{t('sharing.intro.firefox')}</li>
              </ul>
              <p>{t('sharing.intro.fingerprint')}</p>
            </>
          )}
          <p>{t('sharing.intro.firewall')}</p>
          <p>{t('sharing.intro.lifetime')}</p>
        </>
      )}
    </SharingDialog>
  );
}
