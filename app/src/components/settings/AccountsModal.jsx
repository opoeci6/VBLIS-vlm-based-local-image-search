import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Loader2, MoreHorizontal, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilterToggle } from '../search/filters/FilterToggle';
import { Switch, PermissionSwitch } from './PermissionSwitch';
import { Field, cardClass, dangerButton, errorClass, primaryButton, secondaryButton } from './serverUi';
import { useAccounts } from '../../hooks/useAccounts';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useSession } from '../../session/sessionContext';
import { cn } from '../../utils/cn';

// One grid for the header and the rows, from 640 px up. Below that every account is a stacked card.
const GRID = 'sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_repeat(4,minmax(0,0.9fr))_auto] sm:items-center sm:gap-3';

const DEFAULT_NEW_PERMISSIONS = { originals: false, image_search: true, places: true };

const badgeClass = 'px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider border flex-shrink-0';

const MENU_ID = 'accounts-row-menu';
const MENU_GAP = 4;

// Where a row's open menu goes, in the overlay's coordinates: under its button, or above it when there is no
// room below. The menu lives outside the scrolling list, so a short list (one account) can't cut it off.
function placeMenu(anchor, overlay, menu) {
  const a = anchor.getBoundingClientRect();
  const o = overlay.getBoundingClientRect();
  const height = menu.offsetHeight;
  const right = Math.max(MENU_GAP, o.right - a.right);
  const fitsBelow = a.bottom + MENU_GAP + height <= o.bottom - MENU_GAP;
  const fitsAbove = a.top - MENU_GAP - height >= o.top + MENU_GAP;
  if (fitsBelow || !fitsAbove) {
    return { top: fitsBelow ? a.bottom - o.top + MENU_GAP : Math.max(MENU_GAP, o.height - height - MENU_GAP), right };
  }
  return { bottom: o.bottom - a.top + MENU_GAP, right };
}

// "Original files still contain their location" applies to a viewer who may open files but not see places.
const showsLocationHint = (role, permissions) => role === 'viewer' && Boolean(permissions?.originals) && !permissions?.places;

function LocationHint() {
  const { t } = useTranslation('session');
  return <p className="text-[11px] text-amber-700 dark:text-amber-300">{t('accounts.locationHint')}</p>;
}

const GRANT_TITLE_KEYS = { originals: 'originals', image_search: 'imageSearch', places: 'places' };

// The changes the network server asks the owner's password for even while it remembers a correct one:
// anything on your own account, a new owner (promoting a viewer, turning an owner back on), and setting an
// owner's password. `kind` is a step kind: rename, changeRole, setPassword, delete, turnOn, turnOff, grant.
const alwaysAsksPassword = (kind, account, isYou) => (
  isYou
  || (kind === 'changeRole' && account.role === 'viewer')
  || (kind === 'turnOn' && account.role === 'owner')
  || (kind === 'setPassword' && account.role === 'owner')
);

// The step that asks for the acting owner's password (and the step's own fields) before a change.
// `permission` is the API name of the permission a 'grant' step switches on. `needsPassword` is false on the
// desktop and while the network server remembers the password: the step then only confirms. `again` says the
// server asked for the password after all.
function ConfirmStep({ kind, permission, account, isYou, limits, needsPassword, again, onSubmit, onCancel, onBusyChange }) {
  const { t } = useTranslation('session');
  const [newName, setNewName] = useState(account.name);
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const backdropDismiss = useBackdropDismiss(() => { if (!isBusy) onCancel(); });
  // On a phone Back closes this step before the Accounts window under it.
  useBackToClose(true, () => { if (!isBusy) onCancel(); });

  const { name } = account;
  let text;
  if (kind === 'rename') {
    text = { title: t('accounts.confirm.rename.title', { name }), desc: null, submit: t('accounts.confirm.rename.submit') };
  } else if (kind === 'changeRole' && account.role === 'viewer') {
    text = { title: t('accounts.confirm.promote.title', { name }), desc: t('accounts.confirm.promote.desc', { name }), submit: t('accounts.confirm.promote.submit') };
  } else if (kind === 'changeRole') {
    text = { title: t('accounts.confirm.demote.title', { name }), desc: t('accounts.confirm.demote.desc', { name }), submit: t('accounts.confirm.demote.submit') };
  } else if (kind === 'setPassword') {
    text = {
      title: t('accounts.confirm.setPassword.title', { name }),
      desc: isYou ? t('accounts.confirm.setPassword.descYou') : t('accounts.confirm.setPassword.desc', { name }),
      submit: t('accounts.confirm.setPassword.submit')
    };
  } else if (kind === 'delete') {
    text = { title: t('accounts.confirm.delete.title', { name }), desc: t('accounts.confirm.delete.desc', { name }), submit: t('accounts.confirm.delete.submit') };
  } else if (kind === 'turnOff') {
    text = { title: t('accounts.confirm.turnOff.title', { name }), desc: t('accounts.confirm.turnOff.desc', { name }), submit: t('accounts.confirm.turnOff.submit') };
  } else if (kind === 'grant') {
    text = {
      title: t(`accounts.confirm.grant.${GRANT_TITLE_KEYS[permission]}`, { name }),
      desc: t('accounts.confirm.grant.desc', { name }),
      submit: t('accounts.confirm.grant.submit')
    };
  } else {
    text = { title: t('accounts.confirm.turnOn.title', { name }), desc: t('accounts.confirm.turnOn.desc', { name }), submit: t('accounts.confirm.turnOn.submit') };
  }
  const isDanger = kind === 'delete' || kind === 'turnOff';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isBusy) return;
    const trimmedName = newName.trim();
    if (kind === 'rename') {
      if (!trimmedName) return setError(t('accounts.add.nameRequired'));
      if (trimmedName.length > limits.name_max) return setError(t('accounts.add.nameTooLong', { max: limits.name_max }));
    }
    if (kind === 'setPassword') {
      if (newPassword !== repeat) return setError(t('passwordRules.mismatch'));
      if (newPassword.length < limits.password_min) return setError(t('passwordRules.tooShort', { min: limits.password_min }));
      if (newPassword.length > limits.password_max) return setError(t('passwordRules.tooLong', { max: limits.password_max }));
    }
    if (needsPassword && !current) return setError(t('accounts.confirm.passwordRequired'));
    setError(null);
    setIsBusy(true);
    onBusyChange(true);
    const result = await onSubmit({ name: trimmedName, newPassword, currentPassword: needsPassword ? current : undefined });
    setIsBusy(false);
    onBusyChange(false);
    // A step that now asks for the password explains itself with its own line, not with the refusal.
    if (!result.ok && !result.reopened) setError(result.message);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 dark:bg-black/60 p-4"
      {...backdropDismiss}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        onSubmit={handleSubmit}
        className="w-[420px] max-w-full max-h-full overflow-y-auto bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-2xl p-5 shadow-2xl space-y-3"
      >
        <h3 className="text-base font-bold text-neutral-900 dark:text-white">{text.title}</h3>
        {text.desc && <p className="text-xs text-neutral-600 dark:text-neutral-400">{text.desc}</p>}
        {kind === 'rename' && (
          <Field id="confirm-new-name" label={t('accounts.confirm.rename.newName')} autoComplete="off" autoFocus disabled={isBusy} value={newName} onChange={setNewName} />
        )}
        {kind === 'setPassword' && (
          <>
            <Field id="confirm-new-password" label={t('accounts.confirm.setPassword.new')} type="password" autoComplete="new-password" disabled={isBusy} value={newPassword} onChange={setNewPassword} />
            <Field id="confirm-repeat-password" label={t('accounts.confirm.setPassword.repeat')} type="password" autoComplete="new-password" disabled={isBusy} value={repeat} onChange={setRepeat} />
          </>
        )}
        {needsPassword && again && <p className="text-xs text-amber-700 dark:text-amber-300" role="status">{t('accounts.confirm.again')}</p>}
        {needsPassword && (
          <Field
            id="confirm-current-password"
            label={t('accounts.confirm.password')}
            type="password"
            autoComplete="current-password"
            autoFocus={kind !== 'rename' || again}
            disabled={isBusy}
            value={current}
            onChange={setCurrent}
          />
        )}
        {error && <p className={errorClass} role="alert">{error}</p>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={isBusy} className={secondaryButton}>{t('common:cancel')}</button>
          <button type="submit" disabled={isBusy} className={isDanger ? dangerButton : primaryButton}>
            {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {isBusy ? t('accounts.confirm.working') : text.submit}
          </button>
        </div>
      </form>
    </div>
  );
}

// The card that creates an account. `onAdd(fields)` resolves to { ok } or { ok: false, message }.
// `passwordFor` says when the card has the owner's password field: 'never' (the desktop), 'always', or 'owners'
// (the network server remembers the password: only a new owner needs it, or a viewer once the server asked).
function AddAccountCard({ limits, passwordFor, onAdd, onClose, uiTheme }) {
  const { t } = useTranslation('session');
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [permissions, setPermissions] = useState(DEFAULT_NEW_PERMISSIONS);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const showPassword = passwordFor === 'always' || (passwordFor === 'owners' && (role === 'owner' || again));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isBusy) return;
    const trimmed = name.trim();
    if (!trimmed) return setError(t('accounts.add.nameRequired'));
    if (trimmed.length > limits.name_max) return setError(t('accounts.add.nameTooLong', { max: limits.name_max }));
    if (password !== repeat) return setError(t('passwordRules.mismatch'));
    if (password.length < limits.password_min) return setError(t('passwordRules.tooShort', { min: limits.password_min }));
    if (password.length > limits.password_max) return setError(t('passwordRules.tooLong', { max: limits.password_max }));
    if (showPassword && !current) return setError(t('accounts.confirm.passwordRequired'));
    setError(null);
    setIsBusy(true);
    const result = await onAdd({ name: trimmed, role, password, permissions, currentPassword: showPassword ? current : undefined });
    setIsBusy(false);
    if (result.ok) return;
    if (result.code === 'confirm_password' && !showPassword) {
      setAgain(true);
      return;
    }
    setError(result.message);
  };

  const setPermission = (key) => (value) => setPermissions((prev) => ({ ...prev, [key]: value }));

  return (
    <form onSubmit={handleSubmit} className={cardClass} aria-label={t('accounts.add.title')}>
      <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{t('accounts.add.title')}</h3>
      <Field
        id="add-account-name"
        label={t('accounts.add.name')}
        autoComplete="off"
        autoFocus
        disabled={isBusy}
        value={name}
        onChange={setName}
        hint={t('accounts.add.nameHint', { max: limits.name_max })}
      />
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={t('accounts.add.role')}>
        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{t('accounts.add.role')}</span>
        <FilterToggle pressed={role === 'viewer'} onClick={() => setRole('viewer')} disabled={isBusy}>{t('role.viewer')}</FilterToggle>
        <FilterToggle pressed={role === 'owner'} onClick={() => setRole('owner')} disabled={isBusy}>{t('role.owner')}</FilterToggle>
      </div>
      <Field id="add-account-password" label={t('accounts.add.password')} type="password" autoComplete="new-password" disabled={isBusy} value={password} onChange={setPassword} />
      <Field id="add-account-repeat" label={t('accounts.add.repeat')} type="password" autoComplete="new-password" disabled={isBusy} value={repeat} onChange={setRepeat} />
      {role === 'viewer' && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{t('accounts.add.permissions')}</p>
          <PermissionSwitch label={t('accounts.switches.originals')} checked={permissions.originals} disabled={isBusy} onChange={setPermission('originals')} uiTheme={uiTheme} />
          <PermissionSwitch label={t('accounts.switches.imageSearch')} checked={permissions.image_search} disabled={isBusy} onChange={setPermission('image_search')} uiTheme={uiTheme} />
          <PermissionSwitch label={t('accounts.switches.places')} checked={permissions.places} disabled={isBusy} onChange={setPermission('places')} uiTheme={uiTheme} />
          {showsLocationHint('viewer', permissions) && <LocationHint />}
        </div>
      )}
      {showPassword && again && <p className="text-xs text-amber-700 dark:text-amber-300" role="status">{t('accounts.confirm.again')}</p>}
      {showPassword && (
        <Field id="add-account-current" label={t('accounts.confirm.password')} type="password" autoComplete="current-password" disabled={isBusy} value={current} onChange={setCurrent} />
      )}
      {error && <p className={errorClass} role="alert">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={isBusy} className={primaryButton}>
          {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {isBusy ? t('accounts.add.submitting') : t('accounts.add.submit')}
        </button>
        <button type="button" onClick={onClose} disabled={isBusy} className={secondaryButton}>{t('common:cancel')}</button>
      </div>
    </form>
  );
}

// One account: a stacked card on a narrow screen, a row of the grid from 640 px up.
// The actions of one account. Rendered by the window at its top level (see `placeMenu`), not in the row.
function RowMenu({ account, isYou, placement, panelRef, onMenuAction }) {
  const { t } = useTranslation('session');
  // Up and Down move between the actions that can be picked
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement);
    const down = event.key === 'ArrowDown';
    const next = at === -1 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      id={MENU_ID}
      ref={panelRef}
      role="menu"
      aria-label={t('accounts.actionsFor', { name: account.name })}
      onKeyDown={onKeyDown}
      // Measured hidden first, then placed before the browser paints
      style={placement ?? { top: 0, right: 0, visibility: 'hidden' }}
      className="absolute z-10 min-w-[11rem] max-h-[calc(100%-8px)] overflow-y-auto py-1 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-xl"
    >
      {[
        { action: 'rename', text: t('accounts.menu.rename'), ownDisabled: false },
        { action: 'changeRole', text: t('accounts.menu.changeRole'), ownDisabled: true },
        { action: 'setPassword', text: t('accounts.menu.setPassword'), ownDisabled: false },
        { action: 'signOut', text: t('accounts.menu.signOut'), ownDisabled: false },
        { action: 'delete', text: t('accounts.menu.delete'), ownDisabled: true }
      ].map(({ action, text, ownDisabled }) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          disabled={isYou && ownDisabled}
          title={isYou && ownDisabled ? t('accounts.ownAccount') : undefined}
          onClick={() => onMenuAction(account, action)}
          className="block w-full text-left px-3 py-2 max-sm:py-3 max-sm:text-sm text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-800 focus:bg-gray-100 dark:focus:bg-neutral-800 outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function AccountRow({ account, isYou, pendingKey, error, isMenuOpen, menuRef, uiTheme, onPermission, onTurn, onToggleMenu }) {
  const { t } = useTranslation('session');
  const { id, name, role, disabled } = account;
  const isOwner = role === 'owner';
  const isBusy = Boolean(pendingKey);
  const ownAccountTip = isYou ? t('accounts.ownAccount') : undefined;

  const permissionColumns = [
    { api: 'originals', column: t('accounts.columns.originals'), label: t('accounts.switches.originals') },
    { api: 'image_search', column: t('accounts.columns.imageSearch'), label: t('accounts.switches.imageSearch') },
    { api: 'places', column: t('accounts.columns.places'), label: t('accounts.switches.places') }
  ];
  const switchLabel = (permission) => t('accounts.permissionFor', { permission, name });
  const cellClass = 'flex items-center justify-between gap-3 min-w-0 max-sm:min-h-10 sm:justify-start';
  const cardLabel = (text) => <span className="text-[11px] font-semibold text-neutral-500 sm:hidden" aria-hidden="true">{text}</span>;

  return (
    <div
      role="row"
      className={cn(
        'flex flex-col gap-2 p-3 max-sm:relative rounded-2xl border border-gray-100 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-800/20',
        'sm:rounded-none sm:border-0 sm:border-b sm:bg-transparent dark:sm:bg-transparent sm:px-3 sm:py-2',
        GRID
      )}
    >
      <div role="cell" className="flex items-center gap-2 min-w-0 max-sm:pr-12">
        <span className="text-sm font-bold truncate text-neutral-800 dark:text-neutral-200" title={name}>{name}</span>
        {isYou && <span className={cn(badgeClass, 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30')}>{t('accounts.you')}</span>}
        {disabled && <span className={cn(badgeClass, 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30')}>{t('accounts.turnedOff')}</span>}
      </div>

      <div role="cell" className="text-xs text-neutral-600 dark:text-neutral-400">
        {isOwner ? t('role.owner') : t('role.viewer')}
      </div>

      {permissionColumns.map(({ api, column, label }) => (
        <div key={api} role="cell" className={cellClass}>
          {cardLabel(column)}
          {isOwner ? (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{t('accounts.always')}</span>
          ) : (
            <Switch
              checked={Boolean(account.permissions?.[api])}
              disabled={isBusy}
              busy={pendingKey === api}
              onChange={(value) => onPermission(account, api, value)}
              label={switchLabel(label)}
              uiTheme={uiTheme}
            />
          )}
        </div>
      ))}

      <div role="cell" className={cellClass}>
        {cardLabel(t('accounts.columns.on'))}
        <Switch
          checked={!disabled}
          disabled={isBusy || isYou}
          busy={pendingKey === 'on'}
          onChange={(value) => onTurn(account, value)}
          label={switchLabel(t('accounts.switches.on'))}
          title={ownAccountTip}
          uiTheme={uiTheme}
        />
      </div>

      <div role="cell" className="relative flex justify-end max-sm:absolute max-sm:top-1.5 max-sm:right-1.5" ref={isMenuOpen ? menuRef : undefined}>
        <button
          type="button"
          onClick={() => onToggleMenu(id)}
          disabled={isBusy}
          aria-label={t('accounts.actionsFor', { name })}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-controls={isMenuOpen ? MENU_ID : undefined}
          className="p-2 max-sm:flex max-sm:h-10 max-sm:w-10 max-sm:items-center max-sm:justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all disabled:opacity-40 cursor-pointer"
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>

      {(showsLocationHint(role, account.permissions) || error) && (
        <div role="cell" className="space-y-1 sm:col-span-full">
          {showsLocationHint(role, account.permissions) && <LocationHint />}
          {error && <p className={errorClass} role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

// The owner's list of accounts: who may sign in, what each viewer may do, and the changes to them.
// `mode` is 'desktop' (the Windows app: no password anywhere, nobody is "you") or 'network' (a browser: the
// owner's password confirms a change, except while the server remembers it); it defaults to the session's.
// It renders in place (not in a portal) so the terminal theme's classes on an ancestor still apply.
export function AccountsModal({ onClose, uiTheme = 'modern', setToast, mode: modeProp }) {
  const { t } = useTranslation('session');
  const { refresh, mode: sessionMode } = useSession();
  const mode = modeProp ?? sessionMode;
  const isDesktop = mode === 'desktop';
  const {
    accounts, you, limits, isLoading, loadFailed, reload, add, update, setPassword, signOut, remove, isConfirmRemembered
  } = useAccounts({ mode });
  const backdropDismiss = useBackdropDismiss(onClose);
  const [menuFor, setMenuFor] = useState(null);
  const [step, setStep] = useState(null);
  const [isStepBusy, setIsStepBusy] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addPasswordFor, setAddPasswordFor] = useState('always');
  // What each row is doing now, { [id]: 'originals' | 'on' | ... }, and the last refusal of an inline action.
  const [pending, setPending] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  // The open row's actions cell (the menu's anchor), the menu itself, the overlay it is placed in, the list.
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);
  const overlayRef = useRef(null);
  const listRef = useRef(null);
  const [menuPlacement, setMenuPlacement] = useState(null);

  const modern = uiTheme === 'modern';
  const atLimit = accounts.length >= limits.max_accounts;

  const closeStep = useCallback(() => {
    setStep(null);
    setIsStepBusy(false);
  }, []);

  // Esc closes the innermost thing: the menu (back to its button), then the confirm step, then the dialog.
  useEscapeKey(true, () => {
    if (menuFor) {
      menuRef.current?.querySelector('button')?.focus();
      setMenuFor(null);
    } else if (step) {
      if (!isStepBusy) closeStep();
    } else onClose();
  });
  // On a phone Back closes the window (the confirm step has its own entry above it).
  useBackToClose(true, onClose);

  // A press anywhere but the menu or its button closes it, and so does scrolling the list or resizing the
  // window, which would move the button away from the menu.
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    const onMouseDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !menuPanelRef.current?.contains(event.target)) close();
    };
    const list = listRef.current;
    document.addEventListener('mousedown', onMouseDown);
    list?.addEventListener('scroll', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      list?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [menuFor]);

  // Place the menu next to its button before the browser paints.
  useLayoutEffect(() => {
    const anchor = menuRef.current;
    const overlay = overlayRef.current;
    const panel = menuPanelRef.current;
    setMenuPlacement(menuFor && anchor && overlay && panel ? placeMenu(anchor, overlay, panel) : null);
  }, [menuFor]);

  // Once it is placed (a hidden element can't take focus), the keyboard goes to its first action.
  useEffect(() => {
    if (menuPlacement) menuPanelRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [menuPlacement]);

  const openAdd = () => {
    if (isDesktop) setAddPasswordFor('never');
    else setAddPasswordFor(isConfirmRemembered() ? 'owners' : 'always');
    setIsAdding(true);
  };

  // An action of one row that needs no confirmation. Resolves to the call's result. A refusal that asks for
  // the password (the server forgot it) goes to `onNeedPassword` instead of showing in the row.
  const runInline = async (id, key, action, onNeedPassword) => {
    setRowErrors((prev) => ({ ...prev, [id]: null }));
    setPending((prev) => ({ ...prev, [id]: key }));
    const result = await action();
    setPending((prev) => ({ ...prev, [id]: null }));
    if (!result.ok) {
      if (onNeedPassword && result.code === 'confirm_password') onNeedPassword();
      else setRowErrors((prev) => ({ ...prev, [id]: result.message }));
    }
    return result;
  };

  // Does this change need the owner's password typed in? Not on the desktop, and on the network not while
  // the server remembers it, unless the server always asks for this change.
  const needsPasswordFor = (kind, account) => (
    !isDesktop && (!isConfirmRemembered() || alwaysAsksPassword(kind, account, account.id === you))
  );

  const openStep = (next, account) => setStep({ ...next, needsPassword: needsPasswordFor(next.kind, account) });

  // Taking access away happens at once. Giving it (a permission switched on, an account turned back on)
  // happens at once on the desktop and while the network server remembers the owner's password; otherwise
  // it asks for it first, as does turning an owner on or off: a browser left signed in can't be used to
  // widen anyone's access.
  const handlePermission = (account, api, value) => {
    if (!value) return runInline(account.id, api, () => update(account.id, { permissions: { [api]: false } }));
    if (needsPasswordFor('grant', account)) {
      openStep({ kind: 'grant', id: account.id, permission: api }, account);
      return undefined;
    }
    return runInline(
      account.id,
      api,
      () => update(account.id, { permissions: { [api]: true } }),
      () => setStep({ kind: 'grant', id: account.id, permission: api, needsPassword: true, again: true })
    );
  };

  const handleTurn = (account, value) => {
    if (account.role === 'viewer' && !value) return runInline(account.id, 'on', () => update(account.id, { disabled: true }));
    if (value && !needsPasswordFor('turnOn', account)) {
      return runInline(
        account.id,
        'on',
        () => update(account.id, { disabled: false }),
        () => setStep({ kind: 'turnOn', id: account.id, needsPassword: true, again: true })
      );
    }
    openStep({ kind: value ? 'turnOn' : 'turnOff', id: account.id }, account);
    return undefined;
  };

  const handleMenuAction = async (account, action) => {
    setMenuFor(null);
    if (action !== 'signOut') {
      openStep({ kind: action, id: account.id }, account);
      return;
    }
    const result = await runInline(account.id, 'menu', () => signOut(account.id));
    if (result.ok) {
      setToast?.({
        message: account.id === you ? t('accounts.done.signedOutYou') : t('accounts.done.signedOut', { name: account.name }),
        type: 'success'
      });
    }
  };

  const submitStep = async ({ name, newPassword, currentPassword }) => {
    const account = accounts.find((item) => item.id === step.id);
    const { kind } = step;
    let result;
    if (kind === 'rename') result = await update(account.id, { name }, currentPassword);
    else if (kind === 'changeRole') result = await update(account.id, { role: account.role === 'viewer' ? 'owner' : 'viewer' }, currentPassword);
    else if (kind === 'setPassword') result = await setPassword(account.id, newPassword, currentPassword);
    else if (kind === 'delete') result = await remove(account.id, currentPassword);
    else if (kind === 'grant') result = await update(account.id, { permissions: { [step.permission]: true } }, currentPassword);
    else result = await update(account.id, { disabled: kind === 'turnOff' }, currentPassword);
    if (!result.ok) {
      // The server asked for the password after all: show the field in the same step.
      if (result.code === 'confirm_password' && !step.needsPassword) {
        setStep({ ...step, needsPassword: true, again: true });
        return { ...result, reopened: true };
      }
      return result;
    }
    if (kind === 'rename' && account.id === you) await refresh?.();
    if (kind === 'setPassword') setToast?.({ message: t('accounts.done.passwordSet', { name: account.name }), type: 'success' });
    closeStep();
    return result;
  };

  const handleAdd = async (fields) => {
    const result = await add(fields);
    if (result.ok) {
      setIsAdding(false);
      setToast?.({ message: t('accounts.done.added', { name: fields.name }), type: 'success' });
    }
    return result;
  };

  const stepAccount = step ? accounts.find((item) => item.id === step.id) : null;
  const menuAccount = menuFor ? accounts.find((item) => item.id === menuFor) : null;

  // The window opens from inside a Settings section, whose `space-y-*` would give this overlay a top margin
  // (a fixed element keeps its margin): on a phone it then started 16 px down and lost its bottom 16 px. `!m-0`.
  return (
    <div
      ref={overlayRef}
      className="app-overlay fixed inset-0 !m-0 z-[70] flex items-stretch justify-center bg-black/50 dark:bg-black/75 backdrop-blur-md sm:items-center sm:p-4 animate-in fade-in duration-200"
      {...backdropDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('accounts.title')}
        className={cn(
          'w-full sm:w-[880px] max-w-full h-dvh sm:h-auto sm:max-h-[85dvh] pt-safe pb-safe px-safe sm:p-0 flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200',
          modern
            ? 'bg-white dark:bg-neutral-900 sm:border border-gray-200 dark:border-neutral-800 sm:rounded-3xl'
            : 'bg-white dark:bg-black sm:border border-black dark:border-white'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-neutral-800 flex items-start justify-between gap-3 sm:gap-4 bg-gray-50/50 dark:bg-neutral-900/50">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{t('accounts.title')}</h2>
            <p className="text-xs text-neutral-500 mt-1">{t('accounts.subtitle')}</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={openAdd}
              disabled={atLimit}
              title={atLimit ? t('accounts.atLimit', { max: limits.max_accounts }) : undefined}
              className={primaryButton}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {t('accounts.add.button')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common:close')}
              title={t('common:close')}
              className="p-2 max-sm:flex max-sm:h-10 max-sm:w-10 max-sm:items-center max-sm:justify-center text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {isAdding && (
            <AddAccountCard limits={limits} passwordFor={addPasswordFor} onAdd={handleAdd} onClose={() => setIsAdding(false)} uiTheme={uiTheme} />
          )}

          {isLoading ? (
            <p className="flex items-center justify-center gap-3 py-16 text-sm font-medium text-neutral-500" role="status">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-hidden="true" />
              {t('accounts.loading')}
            </p>
          ) : loadFailed ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20">
              <p className="flex-1 text-sm text-rose-700 dark:text-rose-300" role="alert">{t('accounts.loadFailed')}</p>
              <button type="button" onClick={reload} className={secondaryButton}>{t('common:retry')}</button>
            </div>
          ) : (
            <div role="table" aria-label={t('accounts.title')} className="space-y-2 sm:space-y-0">
              <div
                role="row"
                className={cn('hidden px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 border-b border-gray-100 dark:border-neutral-800', GRID)}
              >
                <div role="columnheader">{t('accounts.columns.name')}</div>
                <div role="columnheader">{t('accounts.columns.role')}</div>
                <div role="columnheader">{t('accounts.columns.originals')}</div>
                <div role="columnheader">{t('accounts.columns.imageSearch')}</div>
                <div role="columnheader">{t('accounts.columns.places')}</div>
                <div role="columnheader">{t('accounts.columns.on')}</div>
                <div role="columnheader"><span className="sr-only">{t('accounts.columns.actions')}</span></div>
              </div>
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isYou={account.id === you}
                  pendingKey={pending[account.id]}
                  error={rowErrors[account.id]}
                  isMenuOpen={menuFor === account.id}
                  menuRef={menuRef}
                  uiTheme={uiTheme}
                  onPermission={handlePermission}
                  onTurn={handleTurn}
                  onToggleMenu={(id) => setMenuFor((prev) => (prev === id ? null : id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {menuAccount && (
        <RowMenu
          key={menuAccount.id}
          account={menuAccount}
          isYou={menuAccount.id === you}
          placement={menuPlacement}
          panelRef={menuPanelRef}
          onMenuAction={handleMenuAction}
        />
      )}

      {step && stepAccount && (
        <ConfirmStep
          key={`${step.kind}:${step.id}:${step.permission ?? ''}`}
          kind={step.kind}
          permission={step.permission}
          account={stepAccount}
          isYou={stepAccount.id === you}
          limits={limits}
          needsPassword={step.needsPassword}
          again={Boolean(step.again)}
          onSubmit={submitStep}
          onCancel={closeStep}
          onBusyChange={setIsStepBusy}
        />
      )}
    </div>
  );
}
