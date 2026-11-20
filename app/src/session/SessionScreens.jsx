import { useState } from 'react';
import { Image as ImageIcon, Loader2, AlertTriangle } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { SessionThemeControl } from '../components/layout/SessionThemeControl';
import { useThemePreferences } from '../hooks/useThemePreferences';
import { cn } from '../utils/cn';

// The page behind the sign-in, loading and connection-error screens. It follows the saved theme and
// style like the app does. These screens only show in a browser, which has no title bar, so a small
// floating control at the top right switches both here.
function ScreenShell({ children }) {
  const { theme, setTheme, uiTheme, setUiTheme } = useThemePreferences();
  return (
    <div
      className={cn(
        "isolate h-dvh w-full overflow-y-auto overflow-x-hidden font-sans flex flex-col items-center relative pt-safe px-safe custom-scrollbar",
        uiTheme === 'terminal' ? "terminal-theme theme-terminal" : "theme-modern bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
      )}
    >
      <SessionThemeControl theme={theme} setTheme={setTheme} uiTheme={uiTheme} setUiTheme={setUiTheme} />
      <main className="w-full max-w-sm px-4 sm:px-6 my-auto pt-16 pb-10">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
            <ImageIcon className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">VBLIS</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

const cardClass = "bg-white dark:bg-neutral-900/70 border border-gray-200 dark:border-neutral-800 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20 p-6";

const inputClass = "w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-xl py-3 px-4 text-base outline-none transition-all focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 text-neutral-900 dark:text-white";

export function LoadingScreen() {
  const { t } = useTranslation('session');
  return (
    <ScreenShell>
      <div className="flex items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400" role="status">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span className="text-sm font-medium">{t('connecting')}</span>
      </div>
    </ScreenShell>
  );
}

export function ConnectionErrorScreen({ onRetry }) {
  const { t } = useTranslation('session');
  return (
    <ScreenShell>
      <div className={cn(cardClass, "space-y-4 text-center")}>
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
        <h2 className="text-base font-bold text-neutral-900 dark:text-white">{t('connectionError.title')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('connectionError.desc')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="w-full min-h-[44px] px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all active:scale-95 cursor-pointer"
        >
          {t('connectionError.retry')}
        </button>
      </div>
    </ScreenShell>
  );
}

// `failure` is what the sign-in call reported: { kind: 'network' } or { kind: 'http', status, detail, code, retryAfter }.
function FailureMessage({ failure }) {
  const { t } = useTranslation('session');
  if (failure.kind === 'network') return t('signIn.errors.network');
  const { status, code, retryAfter } = failure;
  if (status === 401) return t('signIn.errors.wrongNameOrPassword');
  if (status === 403 && code === 'account_off') return t('signIn.errors.accountOff');
  if (status === 429) {
    return retryAfter ? t('signIn.errors.tooManyAttempts', { count: retryAfter }) : t('signIn.errors.tooManyAttemptsNoWait');
  }
  if (status === 503) {
    if (code === 'no_owner_account') {
      return <Trans t={t} i18nKey="signIn.errors.noOwnerAccount" components={{ code: <code className="font-mono font-semibold" /> }} />;
    }
    if (code === 'no_accounts') return t('signIn.errors.noAccounts');
    return retryAfter ? t('signIn.errors.busy', { count: retryAfter }) : t('signIn.errors.busyNoWait');
  }
  return t('signIn.errors.generic', { status });
}

// `onSignIn(name, password)` resolves to { ok: true } or a failure (see FailureMessage). `expired` is true when
// the user was signed in and the server ended the session. `secure` is false on a plain HTTP connection.
export function SignInScreen({ onSignIn, secure = true, expired = false }) {
  const { t } = useTranslation('session');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || !name.trim() || !password) return;
    setIsSubmitting(true);
    setFailure(null);
    const result = await onSignIn(name.trim(), password);
    // On success the gate swaps this screen for the app, so there is nothing left to update.
    if (!result.ok) {
      setFailure(result);
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell>
      <form onSubmit={handleSubmit} className={cn(cardClass, "space-y-4")}>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white">{t('signIn.title')}</h2>
        {expired && !failure && (
          <p className="text-sm text-amber-700 dark:text-amber-300 font-medium" role="status">{t('signIn.expired')}</p>
        )}
        <div>
          <label htmlFor="vblis-name" className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
            {t('signIn.name')}
          </label>
          <input
            id="vblis-name"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="vblis-password" className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
            {t('signIn.password')}
          </label>
          <input
            id="vblis-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>
        {failure && (
          <p className="text-sm text-rose-600 dark:text-rose-400 font-medium" role="alert">
            <FailureMessage failure={failure} />
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting || !name.trim() || !password}
          className="w-full flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? t('signIn.submitting') : t('signIn.submit')}
        </button>
        {!secure && (
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium" data-testid="insecure-note">
            {t('signIn.insecure')}
          </p>
        )}
      </form>
    </ScreenShell>
  );
}
