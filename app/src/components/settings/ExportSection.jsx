import { useEffect, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsSelect } from '../common/SettingsSelect';
import { Field, cardClass, errorClass, primaryButton, secondaryButton } from './serverUi';
import { pickSavePath } from '../../utils/electron';
import { formatNumber } from '../../utils/formatters';
import { requestJson } from '../../utils/serverRequest';
import { cn } from '../../utils/cn';
import { SectionTitle } from './SectionTitle';

// The error codes of POST /index/export that have a translation here; any other refusal shows the
// message requestJson makes from the backend's `detail`.
const ERROR_KEYS = {
  invalid_path: 'export.errors.invalidPath',
  unknown_model: 'export.errors.unknownModel',
  no_index: 'export.errors.noIndex',
};

const labelClass = 'block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1';
const subtleClass ='text-[11px] text-neutral-500 dark:text-neutral-400';
const nativeSelectClass = 'w-full text-base sm:text-xs p-2 sm:p-1.5 max-sm:min-h-10 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500';

// "Export for another device" (Windows app, owner): writes the index to a .vblis-export file in a queue task,
// to be imported on another machine that then serves the library read-only. The models that have an index
// are read once, when the section mounts; the Export button picks the file (the native save dialog, or a typed
// path on the dev page) and starts the task. Progress is shown by the task queue, not here.
export function ExportSection({ uiTheme, setToast }) {
  const { t } = useTranslation('settings');
  // The answer of GET /index/export/collections: null until it arrives.
  const [data, setData] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The model the owner picked, or null while the default (the active model, else the first) stands.
  const [pickedModel, setPickedModel] = useState(null);
  const [thumbnails, setThumbnails] = useState(true);
  // The typed path, used when there is no native dialog.
  const [typedPath, setTypedPath] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isCurrent = true;
    requestJson('GET', '/index/export/collections').then((result) => {
      if (!isCurrent) return;
      if (result.ok && Array.isArray(result.data?.collections)) {
        setData(result.data);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    });
    return () => { isCurrent = false; };
  }, [attempt]);

  const retry = () => {
    setLoadFailed(false);
    setAttempt((count) => count + 1);
  };

  const hasDialog = Boolean(window.electronAPI?.saveFile);
  const collections = data?.collections ?? [];
  const selected = collections.find((item) => item.model_id === pickedModel)
    ?? collections.find((item) => item.model_id === data?.active_model)
    ?? collections[0]
    ?? null;

  const startExport = async () => {
    setError(null);
    setIsExporting(true);
    try {
      const outputPath = hasDialog ? await pickSavePath('export') : typedPath.trim();
      if (!outputPath) return;
      const result = await requestJson('POST', '/index/export', {
        output_path: outputPath,
        model_id: selected.model_id,
        thumbnails,
      });
      if (result.ok) setToast?.({ message: t('export.started'), type: 'success' });
      else setError(ERROR_KEYS[result.code] ? t(ERROR_KEYS[result.code]) : result.message || t('export.errors.failed'));
    } finally {
      setIsExporting(false);
    }
  };

  const modelOptions = collections.map((item) => ({ value: item.model_id, label: item.model_id }));

  return (
    <div className="space-y-4">
      <SectionTitle>{t('export.title')}</SectionTitle>
      <p className={subtleClass}>{t('export.intro')}</p>

      {!data ? (
        loadFailed ? (
          <div className="flex items-center gap-3">
            <p className={cn(errorClass, 'flex-1')} role="alert">{t('export.loadFailed')}</p>
            <button type="button" onClick={retry} className={secondaryButton}>{t('common:retry')}</button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-neutral-500" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {t('export.loading')}
          </p>
        )
      ) : !selected ? (
        <p className={subtleClass}>{t('export.empty')}</p>
      ) : (
        <div className={cardClass}>
          {collections.length > 1 && (
            <div>
              {uiTheme === 'modern' ? (
                <>
                  <span className={labelClass}>{t('export.model')}</span>
                  <SettingsSelect value={selected.model_id} onChange={setPickedModel} options={modelOptions} disabled={isExporting} />
                </>
              ) : (
                <>
                  <label htmlFor="export-model" className={labelClass}>{t('export.model')}</label>
                  <select id="export-model" value={selected.model_id} onChange={(event) => setPickedModel(event.target.value)} disabled={isExporting} className={nativeSelectClass}>
                    {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </>
              )}
            </div>
          )}
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            {t('export.items', { count: selected.records, n: formatNumber(selected.records) })}
          </p>

          <label className="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer max-sm:min-h-10 max-sm:items-center">
            <input
              type="checkbox"
              checked={thumbnails}
              onChange={(event) => setThumbnails(event.target.checked)}
              disabled={isExporting}
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-indigo-600 cursor-pointer"
            />
            <span>{t('export.thumbnails')}</span>
          </label>

          {!hasDialog && (
            <Field
              id="export-path"
              label={t('export.path')}
              autoComplete="off"
              spellCheck={false}
              disabled={isExporting}
              value={typedPath}
              onChange={setTypedPath}
              hint={t('export.pathHint')}
            />
          )}

          {error && <p className={errorClass} role="alert">{error}</p>}

          <button type="button" onClick={startExport} disabled={isExporting || (!hasDialog && !typedPath.trim())} className={primaryButton}>
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FileDown className="w-3.5 h-3.5" aria-hidden="true" />}
            {t('export.button')}
          </button>
        </div>
      )}
    </div>
  );
}
