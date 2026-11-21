import { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../session/sessionContext';
import { useOwnPassword } from '../../hooks/useOwnPassword';
import { SectionTitle } from './SectionTitle';
import { Fact, Field, cardClass, errorClass, primaryButton, secondaryButton } from './serverUi';

// What the server asks of a new password; its own limits are checked again by the server.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

// The signed-in account in a browser (any role): who it is, its own password, and signing out.
// `showTitle` is false when the page it sits on already carries the title.
export function AccountSection({ setToast, showTitle = true }) {
  const { t } = useTranslation('session');
  const { account, role, signOut } = useSession();
  const { changePassword } = useOwnPassword({ setToast });
  const [current, setCurrent] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (newPassword !== repeat) return setError(t('passwordRules.mismatch'));
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t('passwordRules.tooShort', { min: MIN_PASSWORD_LENGTH }));
    if (newPassword.length > MAX_PASSWORD_LENGTH) return setError(t('passwordRules.tooLong', { max: MAX_PASSWORD_LENGTH }));
    if (!current) return setError(t('account.password.currentRequired'));
    setError(null);
    setIsSaving(true);
    const result = await changePassword({ currentPassword: current, newPassword });
    setIsSaving(false);
    if (result.ok) {
      setCurrent('');
      setNewPassword('');
      setRepeat('');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="space-y-4">
      {showTitle && <SectionTitle>{t('account.title')}</SectionTitle>}

      <div className={cardClass}>
        <Fact label={t('account.name')}>{account?.name}</Fact>
        <Fact label={t('account.role')}>{role === 'owner' ? t('role.owner') : t('role.viewer')}</Fact>
      </div>

      <form onSubmit={handleSubmit} className={cardClass}>
        <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('account.password.title')}</h5>
        {/* Lets a password manager tie the new password to this account */}
        <input type="text" autoComplete="username" value={account?.name ?? ''} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
        <Field id="own-current-password" label={t('account.password.current')} type="password" autoComplete="current-password" value={current} onChange={setCurrent} />
        <Field id="own-new-password" label={t('account.password.new')} type="password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
        <Field id="own-repeat-password" label={t('account.password.repeat')} type="password" autoComplete="new-password" value={repeat} onChange={setRepeat} />
        {error && <p className={errorClass} role="alert">{error}</p>}
        <button type="submit" disabled={isSaving} className={primaryButton}>
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {isSaving ? t('account.password.submitting') : t('account.password.submit')}
        </button>
      </form>

      <button type="button" onClick={() => signOut()} className={secondaryButton}>
        <LogOut className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        {t('signOut')}
      </button>
    </div>
  );
}
