import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { writeJson } from '../../utils/storage';
import { DialogIcon, SharingDialog } from './SharingDialog';
import { dangerButton, primaryButton, secondaryButton } from './serverUi';

export const HTTP_WARNING_OFF_KEY = 'sharing_http_warning_off';

// Why the pop-up opened. Each reason has its own title and buttons:
//   'turn_on'    the switch was flipped on while HTTPS is off
//   'switch_off' the HTTPS choice "Off" was clicked while sharing is on
//   'running'    sharing was already running over plain HTTP when the section opened
const TITLE_KEYS = { turn_on: 'turnOn', switch_off: 'switchOff', running: 'running' };

// What plain HTTP costs, and the "don't warn me again" tick box. The Sharing intro shows the same text.
export function HttpWarningBody({ dontWarn, onDontWarnChange, disabled }) {
  const { t } = useTranslation('settings');
  return (
    <>
      <p>{t('sharing.httpWarning.lead')}</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>{t('sharing.httpWarning.seePictures')}</li>
        <li>{t('sharing.httpWarning.copySession')}</li>
      </ul>
      <p className="font-semibold text-neutral-800 dark:text-neutral-200">{t('sharing.httpWarning.trusted')}</p>
      <p>{t('sharing.httpWarning.httpsIsFree')}</p>
      <label className="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer max-sm:min-h-10 max-sm:items-center">
        <input
          type="checkbox"
          checked={dontWarn}
          onChange={(event) => onDontWarnChange(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-indigo-600 cursor-pointer"
        />
        <span>{t('sharing.httpWarning.dontWarn')}</span>
      </label>
    </>
  );
}

// The warning about sharing over plain HTTP. The caller decides when to open it (never once the tick box was
// ticked). The box is stored when the pop-up closes any way: Cancel, Esc and a click outside included.
// `onUseHttps`, `onContinue` (turn_on: share anyway; switch_off: turn HTTPS off) and `onCancel` do the work.
export function HttpSharingWarningModal({ reason, uiTheme, isBusy, onUseHttps, onContinue, onCancel }) {
  const { t } = useTranslation('settings');
  const [dontWarn, setDontWarn] = useState(false);

  const closeWith = (action) => () => {
    if (dontWarn) writeJson(HTTP_WARNING_OFF_KEY, true);
    action();
  };
  const cancel = closeWith(onCancel);

  let buttons;
  if (reason === 'switch_off') {
    buttons = (
      <>
        <button type="button" onClick={cancel} disabled={isBusy} className={primaryButton}>{t('sharing.httpWarning.keepHttps')}</button>
        <button type="button" onClick={closeWith(onContinue)} disabled={isBusy} className={dangerButton}>{t('sharing.httpWarning.turnHttpsOff')}</button>
      </>
    );
  } else if (reason === 'running') {
    buttons = (
      <>
        <button type="button" onClick={closeWith(onUseHttps)} disabled={isBusy} className={primaryButton}>{t('sharing.httpWarning.useHttps')}</button>
        <button type="button" onClick={cancel} disabled={isBusy} className={secondaryButton}>{t('sharing.httpWarning.keepForNow')}</button>
      </>
    );
  } else {
    buttons = (
      <>
        <button type="button" onClick={closeWith(onUseHttps)} disabled={isBusy} className={primaryButton}>{t('sharing.httpWarning.useHttps')}</button>
        <button type="button" onClick={closeWith(onContinue)} disabled={isBusy} className={dangerButton}>{t('sharing.httpWarning.shareAnyway')}</button>
        <button type="button" onClick={cancel} disabled={isBusy} className={secondaryButton}>{t('common:cancel')}</button>
      </>
    );
  }

  return (
    <SharingDialog
      uiTheme={uiTheme}
      title={t(`sharing.httpWarning.title.${TITLE_KEYS[reason] ?? 'turnOn'}`)}
      icon={<DialogIcon tone="danger"><ShieldAlert className="w-5 h-5" aria-hidden="true" /></DialogIcon>}
      onCancel={cancel}
      buttons={buttons}
    >
      <HttpWarningBody dontWarn={dontWarn} onDontWarnChange={setDontWarn} disabled={isBusy} />
    </SharingDialog>
  );
}
