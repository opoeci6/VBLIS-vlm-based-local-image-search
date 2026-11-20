import { useState, useEffect, useMemo } from 'react';
import { Folder, ChevronRight, ArrowUp, Loader2, X, AlertTriangle, Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cn } from '../../utils/cn';

const sepOf = (path) => (path.includes('\\') && !path.includes('/') ? '\\' : '/');
const lastSegment = (path) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

// The path from the library folder down to the folder being listed: [{ name, path }, ...].
const buildCrumbs = (listing, rootName) => {
  const rootTrimmed = listing.root.replace(/[\\/]+$/, '');
  const sep = sepOf(listing.root);
  const crumbs = [{ name: rootName, path: listing.root }];
  let walked = rootTrimmed;
  for (const segment of listing.path.slice(rootTrimmed.length).split(/[\\/]/).filter(Boolean)) {
    walked = `${walked}${sep}${segment}`;
    crumbs.push({ name: segment, path: walked });
  }
  if (crumbs.length > 1) crumbs[crumbs.length - 1].path = listing.path;
  return crumbs;
};

function Checkbox({ checked, disabled, label, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className="flex items-center justify-center shrink-0 max-sm:h-10 max-sm:w-10 max-sm:-m-2.5 cursor-pointer disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          'flex items-center justify-center w-5 h-5 rounded-lg border transition-all',
          checked
            ? 'bg-indigo-600 border-indigo-600 text-white'
            : 'bg-white dark:bg-neutral-800 border-gray-300 dark:border-neutral-600'
        )}
      >
        {checked && <Check className="w-3.5 h-3.5" strokeWidth={3.5} aria-hidden="true" />}
      </span>
    </button>
  );
}

// Picks folders on the server (network mode, owner). `onConfirm(paths)` queues them for indexing and
// resolves to something truthy when they were queued, which closes the picker.
export function FolderPickerModal({ onClose, onConfirm, uiTheme = 'modern' }) {
  const { t } = useTranslation('folders');
  const backdropDismiss = useBackdropDismiss(onClose);
  // null shows the library folders (the roots); a path shows that folder.
  const [location, setLocation] = useState(null);
  // The last answer: { location, roots | listing | error }. It is loading until it matches `location`.
  const [result, setResult] = useState(null);
  const [roots, setRoots] = useState([]);
  const [selected, setSelected] = useState([]);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome;
      try {
        const url = location === null
          ? `${API_BASE}/fs/roots`
          : `${API_BASE}/fs/list?path=${encodeURIComponent(location)}`;
        const res = await apiFetch(url);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          outcome = { location, error: typeof data?.detail === 'string' && data.detail ? data.detail : null };
        } else if (location === null) {
          outcome = { location, roots: Array.isArray(data?.roots) ? data.roots : [] };
        } else {
          outcome = { location, listing: data };
        }
      } catch {
        outcome = { location, error: null };
      }
      if (cancelled) return;
      if (outcome.roots) setRoots(outcome.roots);
      setResult(outcome);
    })();
    return () => { cancelled = true; };
  }, [location]);

  // Only mounted while open: Esc and, on a phone, the Back button close it.
  useEscapeKey(true, onClose);
  useBackToClose(true, onClose);

  const isLoading = !result || result.location !== location;
  const listing = !isLoading ? result.listing : null;
  const hasError = !isLoading && 'error' in result;
  const crumbs = useMemo(() => {
    if (!listing) return [];
    const root = roots.find((item) => item.path === listing.root);
    return buildCrumbs(listing, root?.name || lastSegment(listing.root));
  }, [listing, roots]);

  const isSelected = (path) => selected.includes(path);
  const toggle = (path) => setSelected((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));

  const goUp = () => setLocation(listing?.parent ?? null);

  const confirm = async () => {
    if (selected.length === 0 || isAdding) return;
    setIsAdding(true);
    try {
      const queued = await onConfirm(selected);
      if (queued) onClose();
    } finally {
      setIsAdding(false);
    }
  };

  const modern = uiTheme === 'modern';

  const renderRow = ({ key, path, name, indexed, unavailable }) => (
    <div
      key={key}
      className={cn(
        'flex items-center gap-3 p-3 rounded-2xl border transition-all',
        modern
          ? 'border-gray-100 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-800/20 hover:bg-gray-100/80 dark:hover:bg-neutral-800/40'
          : 'border-white bg-black hover:border-indigo-400',
        unavailable && 'opacity-50'
      )}
      title={unavailable ? t('picker.unavailableTooltip') : undefined}
    >
      <Checkbox
        checked={isSelected(path)}
        disabled={unavailable}
        label={isSelected(path) ? t('picker.deselectFolder', { name }) : t('picker.selectFolder', { name })}
        onToggle={() => toggle(path)}
      />
      <button
        type="button"
        disabled={unavailable}
        onClick={() => setLocation(path)}
        aria-label={t('picker.openFolder', { name })}
        className="flex flex-1 min-w-0 items-center gap-2.5 text-left cursor-pointer disabled:cursor-not-allowed"
      >
        <Folder className="w-4 h-4 flex-shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold truncate text-neutral-800 dark:text-neutral-200">{name}</span>
          {location === null && (
            <span className="block text-[10px] font-mono truncate text-neutral-500">{path}</span>
          )}
        </span>
        {unavailable ? (
          <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30">
            {t('picker.unavailable')}
          </span>
        ) : indexed ? (
          <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/30">
            {t('picker.indexed')}
          </span>
        ) : null}
        {!unavailable && <ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400" aria-hidden="true" />}
      </button>
    </div>
  );

  return (
    <div
      className="app-overlay fixed inset-0 z-[70] flex items-stretch justify-center bg-black/50 dark:bg-black/75 backdrop-blur-md sm:items-center sm:p-4 animate-in fade-in duration-200"
      {...backdropDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('picker.title')}
        className={cn(
          'w-full sm:w-[640px] max-w-full h-dvh sm:h-auto sm:max-h-[85dvh] pt-safe pb-safe px-safe sm:p-0 flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200',
          modern
            ? 'bg-white dark:bg-neutral-900 sm:border border-gray-200 dark:border-neutral-800 sm:rounded-3xl'
            : 'bg-white dark:bg-black sm:border border-black dark:border-white'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-neutral-800 flex items-start justify-between gap-4 bg-gray-50/50 dark:bg-neutral-900/50">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{t('picker.title')}</h2>
            <p className="text-xs text-neutral-500 mt-1">{t('picker.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close')}
            title={t('common:close')}
            className="p-2 max-sm:flex max-sm:h-10 max-sm:w-10 max-sm:items-center max-sm:justify-center text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all flex-shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav
          aria-label={t('picker.roots')}
          className="px-4 sm:px-5 py-2.5 border-b border-gray-100 dark:border-neutral-800 flex items-center gap-1.5 flex-wrap text-xs"
        >
          <button
            type="button"
            onClick={goUp}
            disabled={location === null}
            className="inline-flex items-center gap-1 px-2 py-1 max-sm:min-h-10 rounded-lg border border-gray-200 dark:border-neutral-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            {t('picker.up')}
          </button>
          <button
            type="button"
            onClick={() => setLocation(null)}
            disabled={location === null}
            className="px-1.5 py-1 max-sm:min-h-10 font-bold cursor-pointer disabled:cursor-default"
          >
            {t('picker.roots')}
          </button>
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="inline-flex items-center gap-1 sm:gap-1.5 min-w-0">
              <ChevronRight className="w-3 h-3 text-neutral-400 flex-shrink-0" aria-hidden="true" />
              {index === crumbs.length - 1 ? (
                <span className="px-1.5 py-1 max-sm:py-2.5 font-bold truncate" aria-current="location">{crumb.name}</span>
              ) : (
                <button type="button" onClick={() => setLocation(crumb.path)} className="px-1.5 py-1 max-sm:min-h-10 font-semibold truncate cursor-pointer">
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-neutral-500" role="status">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium">{t('picker.loading')}</span>
            </div>
          ) : hasError ? (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2" role="alert">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{result.error || t('picker.readFailed')}</span>
            </div>
          ) : location === null ? (
            roots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                <Folder className="w-12 h-12 text-neutral-300 dark:text-neutral-700 mb-4" aria-hidden="true" />
                <h3 className="text-base font-bold text-neutral-800 dark:text-neutral-300">{t('picker.noRootsTitle')}</h3>
                <p className="text-sm text-neutral-500 mt-2 max-w-md">
                  <Trans t={t} i18nKey="picker.noRootsDesc" components={{ code: <code className="font-mono font-semibold" /> }} />
                </p>
              </div>
            ) : (
              roots.map((root) => renderRow({ key: root.path, path: root.path, name: root.name, unavailable: !root.available }))
            )
          ) : (
            <>
              <div
                className={cn(
                  'flex items-center gap-3 p-3 rounded-2xl border',
                  modern ? 'border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-white bg-black'
                )}
              >
                <Checkbox
                  checked={isSelected(listing.path)}
                  label={t('picker.addThisFolder')}
                  onToggle={() => toggle(listing.path)}
                />
                <span className="flex-1 min-w-0 text-sm font-bold truncate text-neutral-800 dark:text-neutral-200">{t('picker.addThisFolder')}</span>
                {listing.indexed && (
                  <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/30">
                    {t('picker.indexed')}
                  </span>
                )}
              </div>
              {(listing.folders || []).map((folder) => renderRow({ key: folder.path, path: folder.path, name: folder.name, indexed: folder.indexed }))}
              {(listing.folders || []).length === 0 && (
                <p className="py-6 text-center text-sm text-neutral-500">{t('picker.empty')}</p>
              )}
              {listing.truncated && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                  {t('picker.truncated')}
                </div>
              )}
              {listing.skipped > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                  {t('picker.skipped', { count: listing.skipped })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-gray-100 dark:border-neutral-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-neutral-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 max-sm:min-h-10 max-sm:flex-1 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 cursor-pointer"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selected.length === 0 || isAdding}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 max-sm:min-h-10 max-sm:flex-1 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isAdding && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {isAdding ? t('picker.adding') : t('picker.add', { count: selected.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
