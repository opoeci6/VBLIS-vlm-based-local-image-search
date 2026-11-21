import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import { formatNumber } from '../../../utils/formatters';
import { useSession } from '../../../session/sessionContext';
import { useReplica } from '../../../session/replicaContext';
import { useBackToClose } from '../../../hooks/useBackToClose';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import {
  DUPLICATE_KINDS,
  MEGAPIXEL_CHOICES,
  ORIENTATIONS,
  formatLabel,
  getDuplicateLabels,
  getOrientationLabels
} from '../../../utils/searchFilters';
import { FilterToggle } from './FilterToggle';
import { FolderFilterTree } from './FolderFilterTree';
import { PlaceFilterTree } from './PlaceFilterTree';

const formatCount = (value) => formatNumber(Number(value || 0));

const Section = ({ title, children }) => (
  <section aria-label={title} className="mb-5">
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{title}</h3>
    {children}
  </section>
);

// 16 px on a phone, where a smaller font makes iOS zoom into the field.
const dateInputClass = 'min-w-0 flex-1 sm:flex-none rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2.5 sm:px-2 sm:py-1.5 text-base sm:text-xs text-neutral-900 dark:text-neutral-100';

// Media kinds that get their own group in the Format section; every other format goes under "Other".
const FORMAT_KINDS = ['image', 'video'];

// Formats to offer: exactly the ones in the index, named and counted by the backend. A selected
// format that is not (or not yet) in the list stays visible so it can be removed.
function listFormats(options, selected) {
  const entries = (options?.formats || []).map(item => ({
    id: item.id,
    label: formatLabel(item.id, { [item.id]: item.label }),
    mediaType: item.media_type,
    count: item.count,
  }));
  selected.forEach(id => {
    if (!entries.some(entry => entry.id === id)) {
      entries.push({ id, label: formatLabel(id, null), mediaType: null, count: null });
    }
  });
  return entries;
}

function Coverage({ options, optionsLoading, optionsError, loadOptions, detailsFilterActive, scanActive, missingDetails }) {
  const { t } = useTranslation('filters');
  if (scanActive) {
    return (
      <div data-testid="filters-coverage" data-warning="false" className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" aria-hidden="true" />
        <span>{t('common:readingMediaDetails')}</span>
      </div>
    );
  }
  if (!options) {
    if (optionsError) {
      return (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          {optionsError}{' '}
          <button type="button" onClick={loadOptions} className="underline cursor-pointer">{t('common:retry')}</button>
        </p>
      );
    }
    return optionsLoading ? <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('coverage.loadingOptions')}</p> : null;
  }

  const registryAvailable = options.registry_available !== false;
  const withDetails = options.with_details ?? 0;
  const totalFiles = options.total_files ?? 0;
  const unavailable = options.unavailable ?? 0;
  // Files in unplugged folders also lack details, but the line above already says so; the warning
  // is for files whose details could be read (or for a registry that is not available at all).
  const warn = detailsFilterActive && (!registryAvailable || missingDetails > 0);
  const detailsParams = { count: Number(totalFiles), withDetails: formatCount(withDetails), total: formatCount(totalFiles), unavailable: formatCount(unavailable) };

  return (
    <div
      data-testid="filters-coverage"
      data-warning={warn ? 'true' : 'false'}
      className={cn(
        'text-xs',
        warn
          ? 'rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200'
          : 'text-neutral-500 dark:text-neutral-400'
      )}
    >
      <p className="flex items-center gap-1.5">
        {warn && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
        <span>
          {registryAvailable
            ? (unavailable > 0 ? t('coverage.detailsWithUnavailable', detailsParams) : t('coverage.details', detailsParams))
            : t('coverage.unavailable')}
        </span>
      </p>
      {missingDetails > 0 ? (
        <p className="mt-1">
          {t('coverage.missing', { count: Number(missingDetails), formatted: formatCount(missingDetails) })}
        </p>
      ) : (
        warn && <p className="mt-1">{t('coverage.hidden')}</p>
      )}
    </div>
  );
}

// Panel with every search filter. Rendered once by App; the Filters button toggles it. It floats under the
// header from sm up, and is a bottom sheet with a dimmed backdrop on a phone. It does not trap focus, and closes
// on Escape (through the shared Esc stack), a click outside it, and the Back button of a phone browser.
export const SearchFiltersPanel = ({ filters, indexedFolders }) => {
  const { t } = useTranslation('filters');
  const { may } = useSession();
  // Reading the missing media details is a change to the index, which a read-only copy refuses.
  const { readOnly } = useReplica();
  const panelRef = useRef(null);
  const { isOpen, close } = filters;

  useBackToClose(isOpen, close);
  useEscapeKey(isOpen, close);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onMouseDown = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-filters-toggle]')) return;
      // The phone backdrop closes on its click instead: closing on the press would let the click land on
      // whatever sits under the finger once the backdrop is gone.
      if (event.target.closest?.('[data-filters-backdrop]')) return;
      close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const {
    mediaType, setMediaType, folders, toggleFolder,
    datePreset, dateFrom, dateTo, setDatePreset, setCustomDate,
    orientations, toggleOrientation, formats, toggleFormat,
    minMegapixels, setMinMegapixels,
    duplicates, toggleDuplicate,
    places, togglePlace,
    activeCount, clearAll,
    options, optionsLoading, optionsError, loadOptions, readDetailsNow, isStartingScan,
    scanActive, missingDetails, detailsFilterActive
  } = filters;

  const formatEntries = listFormats(options, formats);
  const years = options?.years || [];
  const placeNodes = options?.places || [];
  // Hidden unless the backend says it has place data (an older backend sends no such key). While the
  // options are not loaded yet the section is shown with a status line, like the Format section.
  // A viewer without the places permission never sees it, whatever the options say.
  const showPlaces = may('places') && (!options || options.places_available === true);
  const orientationLabels = getOrientationLabels(t);
  const duplicateLabels = getDuplicateLabels(t);
  const formatTitles = { image: t('format.images'), video: t('format.videos'), other: t('format.other') };

  return (
    <>
      {/* Phone only: dims the page behind the sheet; a tap on it closes the sheet. */}
      <div
        data-filters-backdrop="true"
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 z-[59] bg-black/40 animate-in fade-in duration-150 sm:hidden"
      />
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('panel.label')}
      className="fixed z-[60] inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain custom-scrollbar rounded-t-2xl border-t border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 pt-0 pb-0 shadow-2xl text-neutral-900 dark:text-neutral-100 animate-in fade-in slide-in-from-bottom-4 duration-150 sm:inset-x-auto sm:bottom-auto sm:top-24 sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(42rem,calc(100vw-2rem))] sm:max-h-[70dvh] sm:rounded-2xl sm:border sm:px-5 sm:pt-5 sm:pb-0"
    >
      <div className="sticky top-0 z-10 -mx-5 mb-4 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900 sm:static sm:mx-0 sm:border-b-0 sm:p-0">
        <h2 className="text-base font-bold">{t('panel.title')}</h2>
        <button
          type="button"
          onClick={close}
          aria-label={t('panel.close')}
          className="p-3 -m-1 sm:m-0 sm:p-1.5 rounded-lg text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <Section title={t('sections.type')}>
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!mediaType} onClick={() => setMediaType(null)}>{t('type.all')}</FilterToggle>
          <FilterToggle pressed={mediaType === 'image'} onClick={() => setMediaType('image')}>{t('type.images')}</FilterToggle>
          <FilterToggle pressed={mediaType === 'video'} onClick={() => setMediaType('video')}>{t('type.videos')}</FilterToggle>
        </div>
      </Section>

      <Section title={t('sections.folders')}>
        <FolderFilterTree indexedFolders={indexedFolders} selected={folders} onToggle={toggleFolder} />
      </Section>

      <Section title={t('sections.dateTaken')}>
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!datePreset} onClick={() => setDatePreset(null)}>{t('date.any')}</FilterToggle>
          <FilterToggle pressed={datePreset === 'last30'} onClick={() => setDatePreset('last30')}>{t('date.last30')}</FilterToggle>
          <FilterToggle pressed={datePreset === 'last12m'} onClick={() => setDatePreset('last12m')}>{t('date.last12m')}</FilterToggle>
          {years.map(({ year, count }) => (
            <FilterToggle key={year} pressed={datePreset === `year:${year}`} onClick={() => setDatePreset(`year:${year}`)}>
              {t('date.yearCount', { year, n: formatCount(count) })}
            </FilterToggle>
          ))}
          <FilterToggle pressed={datePreset === 'custom'} onClick={() => setDatePreset('custom')}>{t('date.custom')}</FilterToggle>
        </div>
        {datePreset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm sm:text-xs">
            <label className="flex w-full items-center gap-2 sm:w-auto">
              <span>{t('date.from')}</span>
              <input
                type="date"
                value={dateFrom ?? ''}
                onChange={(event) => setCustomDate({ from: event.target.value, to: dateTo })}
                className={dateInputClass}
              />
            </label>
            <label className="flex w-full items-center gap-2 sm:w-auto">
              <span>{t('date.to')}</span>
              <input
                type="date"
                value={dateTo ?? ''}
                onChange={(event) => setCustomDate({ from: dateFrom, to: event.target.value })}
                className={dateInputClass}
              />
            </label>
          </div>
        )}
      </Section>

      {showPlaces && (
        <Section title={t('sections.place')}>
          {!options && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{optionsError ? t('place.unavailable') : t('place.loading')}</p>
          )}
          {options && (placeNodes.length === 0 || options.with_gps === 0) && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('place.noData')}</p>
          )}
          {options && placeNodes.length > 0 && options.with_gps !== 0 && (
            <>
              <PlaceFilterTree places={placeNodes} selected={places} onToggle={togglePlace} />
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t('place.credit')}</p>
            </>
          )}
        </Section>
      )}

      <Section title={t('sections.orientation')}>
        <div className="flex flex-wrap gap-2">
          {ORIENTATIONS.map(id => (
            <FilterToggle key={id} pressed={orientations.includes(id)} onClick={() => toggleOrientation(id)}>
              {orientationLabels[id]}
            </FilterToggle>
          ))}
        </div>
      </Section>

      <Section title={t('sections.format')}>
        {[...FORMAT_KINDS, null].map(kind => {
          const title = formatTitles[kind ?? 'other'];
          const entries = formatEntries.filter(entry => (kind ? entry.mediaType === kind : !FORMAT_KINDS.includes(entry.mediaType)));
          if (entries.length === 0) return null;
          return (
            <div key={kind ?? 'other'} className="mb-2 last:mb-0">
              <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">{title}</p>
              <div className="flex flex-wrap gap-2">
                {entries.map(entry => (
                  <FilterToggle key={entry.id} pressed={formats.includes(entry.id)} onClick={() => toggleFormat(entry.id)}>
                    {entry.count != null ? t('format.withCount', { label: entry.label, n: formatCount(entry.count) }) : entry.label}
                  </FilterToggle>
                ))}
              </div>
            </div>
          );
        })}
        {!options && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{optionsError ? t('format.unavailable') : t('format.loading')}</p>
        )}
        {options && formatEntries.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('format.none')}</p>
        )}
      </Section>

      <Section title={t('sections.duplicates')}>
        <div className="flex flex-wrap gap-2">
          {DUPLICATE_KINDS.map(kind => {
            const count = options?.duplicates?.[kind];
            return (
              <FilterToggle key={kind} pressed={duplicates.includes(kind)} onClick={() => toggleDuplicate(kind)}>
                {typeof count === 'number' ? t('duplicates.withCount', { label: duplicateLabels[kind], n: formatCount(count) }) : duplicateLabels[kind]}
              </FilterToggle>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {t('duplicates.note')}
        </p>
      </Section>

      <Section title={t('sections.minResolution')}>
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!minMegapixels} onClick={() => setMinMegapixels(null)}>{t('resolution.any')}</FilterToggle>
          {MEGAPIXEL_CHOICES.map(value => (
            <FilterToggle key={value} pressed={minMegapixels === value} onClick={() => setMinMegapixels(value)}>
              {t('resolution.megapixels', { mp: value })}
            </FilterToggle>
          ))}
        </div>
      </Section>

      <div className="border-t border-gray-200 dark:border-neutral-800 pt-4">
        <Coverage
          options={options}
          optionsLoading={optionsLoading}
          optionsError={optionsError}
          loadOptions={loadOptions}
          detailsFilterActive={detailsFilterActive}
          scanActive={scanActive}
          missingDetails={missingDetails}
        />
      </div>

      {/* The buttons stay at the bottom of the panel while it scrolls (about 1,600 px on a real library), on a phone
          and on the desktop alike. A sticky element can't leave its parent, so this row is a child of the scrolling
          panel itself; it also keeps clear of a phone's home bar, which is why the panel has no bottom padding. */}
      <div
        data-filters-footer="true"
        className="sticky bottom-0 z-10 -mx-5 mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] dark:border-neutral-800 dark:bg-neutral-900"
      >
        {options?.registry_available !== false && !readOnly && (
          <button
            type="button"
            onClick={readDetailsNow}
            disabled={isStartingScan || scanActive}
            className={cn(
              'min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-xl border text-xs font-semibold disabled:opacity-50 cursor-pointer',
              missingDetails > 0
                ? 'border-indigo-600 bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800'
            )}
          >
            {t('common:readDetailsNow')}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={activeCount === 0}
            className="min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
          >
            {t('panel.clearAll')}
          </button>
          <button
            type="button"
            onClick={close}
            className="min-h-[40px] sm:min-h-0 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
          >
            {t('panel.done')}
          </button>
        </div>
      </div>
    </div>
    </>
  );
};
