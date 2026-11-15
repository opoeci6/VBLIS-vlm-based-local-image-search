import { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilterToggle } from '../search/filters/FilterToggle';
import { useServerSettings } from '../../hooks/useServerSettings';
import { cn } from '../../utils/cn';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

const cardClass = 'p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5';
const inputClass = 'w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-700 rounded-xl py-2 px-3 text-sm outline-none transition-all focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 text-neutral-900 dark:text-white';
const primaryButton = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
const secondaryButton = 'inline-flex items-center justify-center px-3.5 py-2 bg-gray-200 dark:bg-neutral-800 hover:bg-gray-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer';
const dangerButton = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

function PermissionSwitch({ label, checked, disabled, onChange, uiTheme }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{label}</span>
      {uiTheme === 'modern' ? (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 cursor-pointer flex-shrink-0',
            checked ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-neutral-700'
          )}
        >
          <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200', checked ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className="relative inline-flex h-7 w-7 items-center justify-center bg-black border border-white focus:outline-none disabled:cursor-not-allowed flex-shrink-0"
        >
          {checked && <Check className="w-5 h-5 text-white" strokeWidth={3} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

function PasswordInput({ id, label, autoComplete, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function ChangePasswordForm({ onChangePassword }) {
  const { t } = useTranslation('session');
  const [role, setRole] = useState('owner');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (newPassword !== repeat) return setError(t('server.password.errors.mismatch'));
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t('server.password.errors.tooShort'));
    if (newPassword.length > MAX_PASSWORD_LENGTH) return setError(t('server.password.errors.tooLong'));
    if (!current) return setError(t('server.password.errors.currentRequired'));
    setError(null);
    setIsSaving(true);
    const result = await onChangePassword({ role, newPassword, currentPassword: current });
    setIsSaving(false);
    if (result.ok) {
      setNewPassword('');
      setRepeat('');
      setCurrent('');
    } else {
      setError(result.message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cardClass}>
      <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('server.password.title')}</h5>
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={t('server.password.role')}>
        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{t('server.password.role')}</span>
        <FilterToggle pressed={role === 'owner'} onClick={() => setRole('owner')}>{t('server.password.roleOwner')}</FilterToggle>
        <FilterToggle pressed={role === 'viewer'} onClick={() => setRole('viewer')}>{t('server.password.roleViewer')}</FilterToggle>
      </div>
      <PasswordInput id="server-new-password" label={t('server.password.new')} autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
      <PasswordInput id="server-repeat-password" label={t('server.password.repeat')} autoComplete="new-password" value={repeat} onChange={setRepeat} />
      <PasswordInput id="server-current-password" label={t('server.password.current')} autoComplete="current-password" value={current} onChange={setCurrent} />
      {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
      <button type="submit" disabled={isSaving} className={primaryButton}>
        {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {isSaving ? t('server.password.submitting') : t('server.password.submit')}
      </button>
    </form>
  );
}

function RemoveViewerPassword({ onRemove }) {
  const { t } = useTranslation('session');
  const [isOpen, setIsOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setIsOpen(false);
    setCurrent('');
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (!current) return setError(t('server.password.errors.currentRequired'));
    setError(null);
    setIsSaving(true);
    const result = await onRemove(current);
    setIsSaving(false);
    if (result.ok) close();
    else setError(result.message);
  };

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className={secondaryButton}>
        {t('server.removeViewer.button')}
      </button>
    );
  }
  return (
    <form onSubmit={handleSubmit} className={cn(cardClass, 'border-rose-200 dark:border-rose-500/30')}>
      <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{t('server.removeViewer.confirm')}</p>
      <PasswordInput id="server-remove-current" label={t('server.password.current')} autoComplete="current-password" value={current} onChange={setCurrent} />
      {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={isSaving} className={dangerButton}>
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {t('server.removeViewer.submit')}
        </button>
        <button type="button" onClick={close} disabled={isSaving} className={secondaryButton}>{t('common:cancel')}</button>
      </div>
    </form>
  );
}

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

function Fact({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="font-semibold text-neutral-500 dark:text-neutral-400 flex-shrink-0">{label}</span>
      <span className="text-right font-mono text-neutral-700 dark:text-neutral-300 min-w-0 break-all">{children}</span>
    </div>
  );
}

// Settings of the network server, for the owner signed in from a browser.
export function ServerSection({ uiTheme, setToast }) {
  const { t } = useTranslation('session');
  const { settings, loadFailed, isSavingPermissions, setViewerPermission, changePassword, removeViewerPassword, signOutOtherBrowsers } = useServerSettings({ setToast });

  const permissions = settings?.viewer_permissions ?? {};
  const roots = settings?.library_roots ?? [];
  const environment = settings?.from_environment ?? [];
  const httpsKey = HTTPS_LABELS[settings?.tls_mode];

  return (
    <div className="pt-4 mt-2 border-t border-gray-100 dark:border-neutral-800 space-y-4">
      <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('server.title')}</h4>

      {!settings ? (
        loadFailed ? (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{t('server.loadFailed')}</p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-neutral-500" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {t('server.loading')}
          </p>
        )
      ) : (
        <>
          <div className={cardClass}>
            <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('server.viewers.title')}</h5>
            <PermissionSwitch
              label={t('server.viewers.originals')}
              checked={Boolean(permissions.originals)}
              disabled={isSavingPermissions}
              onChange={(value) => setViewerPermission('originals', value)}
              uiTheme={uiTheme}
            />
            <PermissionSwitch
              label={t('server.viewers.imageSearch')}
              checked={Boolean(permissions.image_search)}
              disabled={isSavingPermissions}
              onChange={(value) => setViewerPermission('image_search', value)}
              uiTheme={uiTheme}
            />
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

          <ChangePasswordForm onChangePassword={changePassword} />
          {settings.viewer_password_set && <RemoveViewerPassword onRemove={removeViewerPassword} />}
        </>
      )}

      <SignOutOthers onSignOutOthers={signOutOtherBrowsers} />
    </div>
  );
}
