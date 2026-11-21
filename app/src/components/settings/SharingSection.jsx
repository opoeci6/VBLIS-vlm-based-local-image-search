import { useState } from 'react';
import { Copy, Loader2, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilterToggle } from '../search/filters/FilterToggle';
import { PermissionSwitch } from './PermissionSwitch';
import { SectionTitle } from './SectionTitle';
import { AccountsModal } from './AccountsModal';
import { Field, cardClass, dangerButton, errorClass, primaryButton, secondaryButton } from './serverUi';
import { problemText, useSharing } from '../../hooks/useSharing';
import { copyText, pickFile } from '../../utils/electron';
import { cn } from '../../utils/cn';

const warningClass = 'text-xs font-medium text-amber-700 dark:text-amber-300';
const subtleClass = 'text-[11px] text-neutral-500 dark:text-neutral-400';
const MAX_PORT = 65535;

function CopyButton({ label, onCopy, disabled }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex-shrink-0 p-1.5 max-sm:flex max-sm:h-10 max-sm:w-10 max-sm:items-center max-sm:justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-all disabled:opacity-40 cursor-pointer"
    >
      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
}

// A confirmation step before signing every browser out; `onSignOut` resolves when the call is done.
function SignOutAll({ disabled, onSignOut }) {
  const { t } = useTranslation('settings');
  const [isConfirming, setIsConfirming] = useState(false);

  const run = async () => {
    await onSignOut();
    setIsConfirming(false);
  };

  if (!isConfirming) {
    return (
      <button type="button" onClick={() => setIsConfirming(true)} disabled={disabled} className={secondaryButton}>
        {t('sharing.signOutAll.button')}
      </button>
    );
  }
  return (
    <div className={cn(cardClass, 'border-rose-200 dark:border-rose-500/30')}>
      <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{t('sharing.signOutAll.confirm')}</p>
      <div className="flex gap-2">
        <button type="button" onClick={run} disabled={disabled} className={dangerButton}>
          {disabled && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {t('sharing.signOutAll.submit')}
        </button>
        <button type="button" onClick={() => setIsConfirming(false)} disabled={disabled} className={secondaryButton}>{t('common:cancel')}</button>
      </div>
    </div>
  );
}

// A path field with a "Choose..." button that opens the native file dialog (only in the Windows app).
function FileField({ id, label, value, onChange, chooseLabel, onChoose, disabled }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 min-w-0">
        <Field id={id} label={label} autoComplete="off" spellCheck={false} disabled={disabled} value={value} onChange={onChange} />
      </div>
      {onChoose && (
        <button type="button" onClick={onChoose} disabled={disabled} className={cn(secondaryButton, 'sm:flex-shrink-0')}>{chooseLabel}</button>
      )}
    </div>
  );
}

// "Share on my network" for the Windows app: the switch, the addresses to open, HTTPS, the port, the library
// folders, the accounts and signing every browser out. The state is read once when the section opens.
// Fields that an environment variable sets are shown but can't be changed here.
// `showTitle` is false when the page it sits on already carries the title.
export function SharingSection({ uiTheme, setToast, showTitle = true }) {
  const { t } = useTranslation('settings');
  const { state, isLoading, loadFailed, isBusy, apply, signOutEverywhere, reload } = useSharing();
  // The last refusal: { kind: 'error' | 'warning', text }. It stays until the next action starts.
  const [notice, setNotice] = useState(null);
  const [isManaging, setIsManaging] = useState(false);
  // What is typed, or null while a field shows what the backend has.
  const [portDraft, setPortDraft] = useState(null);
  const [tlsDraft, setTlsDraft] = useState(null);
  const [certDraft, setCertDraft] = useState(null);
  const [keyDraft, setKeyDraft] = useState(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [networkDraft, setNetworkDraft] = useState('');

  const toast = (message, type = 'success') => setToast?.({ message, type });

  // Sends changes; on success tells so (`done`), on a refusal keeps it in view. Resolves to whether it worked.
  const run = async (changes, done) => {
    setNotice(null);
    const result = await apply(changes);
    if (result.ok) {
      if (done) toast(done);
      return true;
    }
    setNotice({ kind: result.code === 'stopped_not_saved' ? 'warning' : 'error', text: result.message });
    return false;
  };

  const copy = async (text) => {
    const result = await copyText(text);
    toast(result.success ? t('sharing.addresses.copied') : result.error, result.success ? 'success' : 'error');
  };

  const signOutAll = async () => {
    setNotice(null);
    const result = await signOutEverywhere();
    toast(result.ok ? t('sharing.signOutAll.done') : result.message || t('sharing.signOutAll.failed'), result.ok ? 'success' : 'error');
  };

  const closeAccounts = () => {
    setIsManaging(false);
    // The accounts may have changed: read the counts again.
    reload();
  };

  const title = showTitle ? <SectionTitle>{t('sharing.title')}</SectionTitle> : null;
  const wrapperClass = 'space-y-4';

  if (!state) {
    return (
      <div className={wrapperClass}>
        {title}
        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-neutral-500" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {t('sharing.loading')}
          </p>
        ) : loadFailed ? (
          <div className="flex items-center gap-3">
            <p className={cn(errorClass, 'flex-1')} role="alert">{t('sharing.loadFailed')}</p>
            <button type="button" onClick={reload} className={secondaryButton}>{t('common:retry')}</button>
          </div>
        ) : null}
      </div>
    );
  }

  const environment = state.from_environment ?? [];
  const isLocked = (field) => environment.includes(field);
  const problems = state.running ? [] : (state.problems ?? []);
  const isStuck = state.enabled && !state.running;
  const roots = state.library_roots ?? [];
  const networks = state.local_networks ?? [];
  const urls = state.urls ?? [];
  const counts = state.accounts;
  const hasFilePicker = Boolean(window.electronAPI?.openFile);
  const hasFolderPicker = Boolean(window.electronAPI?.openDirectory);

  // HTTPS: "off" and "self-signed" apply at once; "own files" opens its fields, and "Use these files" applies.
  const tlsChoice = tlsDraft ?? state.tls_mode;
  const tlsLocked = isLocked('tls_mode');
  const filesLocked = tlsLocked || isLocked('cert_file') || isLocked('key_file');
  const certValue = certDraft ?? state.cert_file ?? '';
  const keyValue = keyDraft ?? state.key_file ?? '';

  const chooseTls = async (mode) => {
    if (mode === 'files') {
      setTlsDraft('files');
    } else if (mode === state.tls_mode) {
      setTlsDraft(null);
    } else if (await run({ tls_mode: mode }, t('sharing.done.saved'))) {
      setTlsDraft(null);
    }
  };

  const useFiles = async () => {
    const saved = await run({ tls_mode: 'files', cert_file: certValue.trim(), key_file: keyValue.trim() }, t('sharing.done.saved'));
    if (saved) {
      setTlsDraft(null);
      setCertDraft(null);
      setKeyDraft(null);
    }
  };

  const choose = (kind, setDraft) => async () => {
    const picked = await pickFile(kind);
    if (picked) setDraft(picked);
  };

  const portValue = portDraft ?? String(state.port ?? '');
  const portChanged = portDraft !== null && portDraft.trim() !== String(state.port);

  const savePort = async () => {
    const port = Number(portValue.trim());
    if (!/^\d+$/.test(portValue.trim()) || port < 1 || port > MAX_PORT) {
      setNotice({ kind: 'error', text: t('sharing.port.invalid') });
      return;
    }
    if (await run({ port }, t('sharing.done.saved'))) setPortDraft(null);
  };

  const rootsLocked = isLocked('library_roots');

  const addFolders = async (paths) => {
    const next = [...roots];
    for (const path of paths) if (path && !next.includes(path)) next.push(path);
    if (next.length === roots.length) return true;
    return run({ library_roots: next }, t('sharing.done.saved'));
  };

  const pickFolders = async () => {
    const paths = await window.electronAPI.openDirectory();
    if (Array.isArray(paths) && paths.length > 0) await addFolders(paths);
  };

  const addTypedFolder = async () => {
    if (await addFolders([folderDraft.trim()])) setFolderDraft('');
  };

  const removeFolder = (root) => run({ library_roots: roots.filter((item) => item !== root) }, t('sharing.done.saved'));

  const networksLocked = isLocked('local_networks');

  const addNetwork = async () => {
    const value = networkDraft.trim();
    if (!value) return;
    if (networks.includes(value)) {
      setNetworkDraft('');
      return;
    }
    if (await run({ local_networks: [...networks, value] }, t('sharing.done.saved'))) setNetworkDraft('');
  };

  const removeNetwork = (network) => run({ local_networks: networks.filter((item) => item !== network) }, t('sharing.done.saved'));

  const httpsOptions = [
    { mode: 'off', label: t('sharing.https.off') },
    { mode: 'self_signed', label: t('sharing.https.selfSigned') },
    { mode: 'files', label: t('sharing.https.files') }
  ];

  return (
    <div className={wrapperClass}>
      {title}

      <div className={cardClass}>
        <PermissionSwitch
          label={t('sharing.switchLabel')}
          checked={Boolean(state.enabled)}
          disabled={isBusy}
          busy={isBusy}
          uiTheme={uiTheme}
          onChange={(value) => run({ enabled: value }, value ? t('sharing.done.started') : t('sharing.done.stopped'))}
        />
        <p
          className={cn('text-xs', state.running ? 'text-emerald-700 dark:text-emerald-300' : isStuck ? warningClass : 'text-neutral-600 dark:text-neutral-400')}
          role="status"
        >
          {state.running ? t('sharing.status.on') : isStuck ? t('sharing.status.stuck') : t('sharing.status.off')}
        </p>
        {problems.length > 0 && (
          <ul className={cn(warningClass, 'list-disc pl-4 space-y-0.5')}>
            {problems.map((problem, index) => <li key={`${problem.code}-${index}`}>{problemText(problem)}</li>)}
          </ul>
        )}
        {notice && <p className={notice.kind === 'warning' ? warningClass : errorClass} role="alert">{notice.text}</p>}
        {environment.length > 0 && <p className={subtleClass}>{t('sharing.fromEnvironment', { names: environment.join(', ') })}</p>}
      </div>

      {urls.length > 0 && (
        <div className={cardClass}>
          <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('sharing.addresses.title')}</h5>
          <p className={subtleClass}>{t('sharing.addresses.hint')}</p>
          <ul className="space-y-1">
            {urls.map((url) => (
              <li key={url} className="flex items-center justify-between gap-2">
                <code className="min-w-0 break-all font-mono text-xs text-neutral-800 dark:text-neutral-200 select-all">{url}</code>
                <CopyButton label={t('sharing.addresses.copy', { url })} onCopy={() => copy(url)} disabled={isBusy} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cardClass}>
        <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('sharing.https.title')}</h5>
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={t('sharing.https.title')}>
          {httpsOptions.map(({ mode, label }) => (
            <FilterToggle key={mode} pressed={tlsChoice === mode} onClick={() => chooseTls(mode)} disabled={isBusy || tlsLocked}>{label}</FilterToggle>
          ))}
        </div>
        {tlsChoice === 'self_signed' && <p className={subtleClass}>{t('sharing.https.selfSignedHint')}</p>}
        {tlsChoice === 'files' && (
          <div className="space-y-2">
            <FileField
              id="sharing-cert-file"
              label={t('sharing.https.certificate')}
              value={certValue}
              onChange={setCertDraft}
              chooseLabel={t('sharing.https.chooseCertificate')}
              onChoose={hasFilePicker ? choose('certificate', setCertDraft) : undefined}
              disabled={isBusy || filesLocked}
            />
            <FileField
              id="sharing-key-file"
              label={t('sharing.https.key')}
              value={keyValue}
              onChange={setKeyDraft}
              chooseLabel={t('sharing.https.chooseKey')}
              onChoose={hasFilePicker ? choose('key', setKeyDraft) : undefined}
              disabled={isBusy || filesLocked}
            />
            <button
              type="button"
              onClick={useFiles}
              disabled={isBusy || filesLocked || !certValue.trim() || !keyValue.trim()}
              className={primaryButton}
            >
              {t('sharing.https.useFiles')}
            </button>
          </div>
        )}
        {state.fingerprint && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{t('sharing.https.fingerprint')}</p>
            <div className="flex items-center justify-between gap-2">
              <code className="min-w-0 break-all font-mono text-xs text-neutral-800 dark:text-neutral-200 select-all">{state.fingerprint}</code>
              <CopyButton label={t('sharing.https.copyFingerprint')} onCopy={() => copy(state.fingerprint)} disabled={isBusy} />
            </div>
            {state.fingerprint_may_change && <p className={warningClass}>{t('sharing.https.fingerprintMayChange')}</p>}
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Field
              id="sharing-port"
              label={t('sharing.port.title')}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PORT}
              disabled={isBusy || isLocked('port')}
              value={portValue}
              onChange={setPortDraft}
              hint={t('sharing.port.hint')}
            />
          </div>
          <button
            type="button"
            onClick={savePort}
            disabled={isBusy || isLocked('port') || !portChanged}
            className={cn(secondaryButton, 'flex-shrink-0 mb-6')}
          >
            {t('sharing.port.save')}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('sharing.folders.title')}</h5>
        {roots.length === 0 ? (
          <p className={subtleClass}>{t('sharing.folders.none')}</p>
        ) : (
          <ul className="space-y-1">
            {roots.map((root) => (
              <li key={root} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs text-neutral-800 dark:text-neutral-200">{root}</span>
                <button
                  type="button"
                  onClick={() => removeFolder(root)}
                  disabled={isBusy || rootsLocked}
                  aria-label={t('sharing.folders.removeFor', { path: root })}
                  className={cn(secondaryButton, 'flex-shrink-0')}
                >
                  {t('sharing.folders.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasFolderPicker ? (
          <button type="button" onClick={pickFolders} disabled={isBusy || rootsLocked} className={secondaryButton}>
            <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {t('sharing.folders.add')}
          </button>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <Field id="sharing-folder-path" label={t('sharing.folders.path')} autoComplete="off" spellCheck={false} disabled={isBusy || rootsLocked} value={folderDraft} onChange={setFolderDraft} />
            </div>
            <button type="button" onClick={addTypedFolder} disabled={isBusy || rootsLocked || !folderDraft.trim()} className={cn(secondaryButton, 'flex-shrink-0')}>
              {t('sharing.folders.add')}
            </button>
          </div>
        )}
        <p className={subtleClass}>{t('sharing.folders.hint')}</p>
      </div>

      <div className={cardClass}>
        <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('sharing.localNetworks.title')}</h5>
        {networks.length === 0 ? (
          <p className={subtleClass}>{t('sharing.localNetworks.none')}</p>
        ) : (
          <ul className="space-y-1">
            {networks.map((network) => (
              <li key={network} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs text-neutral-800 dark:text-neutral-200">{network}</span>
                <button
                  type="button"
                  onClick={() => removeNetwork(network)}
                  disabled={isBusy || networksLocked}
                  aria-label={t('sharing.localNetworks.removeFor', { network })}
                  className={cn(secondaryButton, 'flex-shrink-0')}
                >
                  {t('sharing.localNetworks.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Field
              id="sharing-local-network"
              label={t('sharing.localNetworks.field')}
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              disabled={isBusy || networksLocked}
              value={networkDraft}
              onChange={setNetworkDraft}
            />
          </div>
          <button type="button" onClick={addNetwork} disabled={isBusy || networksLocked || !networkDraft.trim()} className={cn(secondaryButton, 'flex-shrink-0')}>
            {t('sharing.localNetworks.add')}
          </button>
        </div>
        <p className={subtleClass}>{t('sharing.localNetworks.hint')}</p>
      </div>

      <div className={cardClass}>
        <h5 className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{t('session:server.accounts.title')}</h5>
        {counts && (
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {t('session:server.accounts.summary', {
              owners: t('session:server.accounts.owners', { count: counts.owners }),
              viewers: t('session:server.accounts.viewers', { count: counts.viewers })
            })}
          </p>
        )}
        {counts?.can_sign_in === 0 && <p className={warningClass}>{t('sharing.accounts.warning')}</p>}
        <button type="button" onClick={() => setIsManaging(true)} disabled={isBusy} className={secondaryButton}>
          <Users className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {t('session:server.accounts.manage')}
        </button>
      </div>

      <SignOutAll disabled={isBusy} onSignOut={signOutAll} />

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{t('sharing.notes.title')}</p>
        <ul className={cn(subtleClass, 'list-disc pl-4 space-y-0.5')}>
          <li>{t('sharing.notes.lifetime')}</li>
          <li>{t('sharing.notes.firewall')}</li>
          {state.tls_mode === 'off' && <li>{t('sharing.notes.plainHttp')}</li>}
          {state.web_ui === false && <li className={warningClass}>{t('sharing.notes.noWebUi')}</li>}
        </ul>
      </div>

      {isManaging && <AccountsModal mode="desktop" uiTheme={uiTheme} setToast={setToast} onClose={closeAccounts} />}
    </div>
  );
}
