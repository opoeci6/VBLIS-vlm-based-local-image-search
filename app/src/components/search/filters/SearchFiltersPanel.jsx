import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '../../../utils/cn';
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

const formatCount = (value) => Number(value || 0).toLocaleString('en-US');

const Section = ({ title, children }) => (
  <section aria-label={title} className="mb-5">
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{title}</h3>
    {children}
  </section>
);

const dateInputClass = 'rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 py-1.5 text-xs text-neutral-900 dark:text-neutral-100';

const FORMAT_GROUPS = [
  { kind: 'image', title: 'Images' },
  { kind: 'video', title: 'Videos' },
];

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
  if (scanActive) {
    return (
      <div data-testid="filters-coverage" data-warning="false" className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" aria-hidden="true" />
        <span>Reading media details...</span>
      </div>
    );
  }
  if (!options) {
    if (optionsError) {
      return (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          {optionsError}{' '}
          <button type="button" onClick={loadOptions} className="underline cursor-pointer">Retry</button>
        </p>
      );
    }
    return optionsLoading ? <p className="text-xs text-neutral-500 dark:text-neutral-400">Loading filter options...</p> : null;
  }

  const registryAvailable = options.registry_available !== false;
  const withDetails = options.with_details ?? 0;
  const totalFiles = options.total_files ?? 0;
  const unavailable = options.unavailable ?? 0;
  // Files in unplugged folders also lack details, but the line above already says so; the warning
  // is for files whose details could be read (or for a registry that is not available at all).
  const warn = detailsFilterActive && (!registryAvailable || missingDetails > 0);
  const unavailableNote = unavailable > 0 ? ` (${formatCount(unavailable)} in folders that aren't connected)` : '';

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
            ? `Media details for ${formatCount(withDetails)} of ${formatCount(totalFiles)} files${unavailableNote}`
            : 'Media details are unavailable'}
        </span>
      </p>
      {missingDetails > 0 ? (
        <p className="mt-1">
          {`${formatCount(missingDetails)} files have no media details yet. Date, orientation and resolution filters skip them until their details are read. That reads file headers only; no re-indexing.`}
        </p>
      ) : (
        warn && <p className="mt-1">Files without details are hidden by the date, orientation and resolution filters.</p>
      )}
    </div>
  );
}

// Floating panel under the header with every search filter. Rendered once by App; the Filters
// button toggles it. It does not trap focus, and closes on Escape or a click outside it.
export const SearchFiltersPanel = ({ filters, indexedFolders }) => {
  const panelRef = useRef(null);
  const { isOpen, close } = filters;

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    const onMouseDown = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-filters-toggle]')) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const {
    mediaType, setMediaType, folders, toggleFolder,
    datePreset, dateFrom, dateTo, setDatePreset, setCustomDate,
    orientations, toggleOrientation, formats, toggleFormat,
    minMegapixels, setMinMegapixels,
    duplicates, toggleDuplicate,
    activeCount, clearAll,
    options, optionsLoading, optionsError, loadOptions, readDetailsNow, isStartingScan,
    scanActive, missingDetails, detailsFilterActive
  } = filters;

  const formatEntries = listFormats(options, formats);
  const years = options?.years || [];
  const orientationLabels = getOrientationLabels();
  const duplicateLabels = getDuplicateLabels();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Search filters"
      className="fixed z-[60] top-24 left-1/2 -translate-x-1/2 w-[min(42rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto custom-scrollbar rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-2xl text-neutral-900 dark:text-neutral-100 animate-in fade-in duration-150"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Filters</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close filters"
          className="p-1.5 rounded-lg text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <Section title="Type">
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!mediaType} onClick={() => setMediaType(null)}>All</FilterToggle>
          <FilterToggle pressed={mediaType === 'image'} onClick={() => setMediaType('image')}>Images</FilterToggle>
          <FilterToggle pressed={mediaType === 'video'} onClick={() => setMediaType('video')}>Videos</FilterToggle>
        </div>
      </Section>

      <Section title="Folders">
        <FolderFilterTree indexedFolders={indexedFolders} selected={folders} onToggle={toggleFolder} />
      </Section>

      <Section title="Date taken">
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!datePreset} onClick={() => setDatePreset(null)}>Any</FilterToggle>
          <FilterToggle pressed={datePreset === 'last30'} onClick={() => setDatePreset('last30')}>Last 30 days</FilterToggle>
          <FilterToggle pressed={datePreset === 'last12m'} onClick={() => setDatePreset('last12m')}>Last 12 months</FilterToggle>
          {years.map(({ year, count }) => (
            <FilterToggle key={year} pressed={datePreset === `year:${year}`} onClick={() => setDatePreset(`year:${year}`)}>
              {year} ({formatCount(count)})
            </FilterToggle>
          ))}
          <FilterToggle pressed={datePreset === 'custom'} onClick={() => setDatePreset('custom')}>Custom...</FilterToggle>
        </div>
        {datePreset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span>From</span>
              <input
                type="date"
                value={dateFrom ?? ''}
                onChange={(event) => setCustomDate({ from: event.target.value, to: dateTo })}
                className={dateInputClass}
              />
            </label>
            <label className="flex items-center gap-2">
              <span>To</span>
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

      <Section title="Orientation">
        <div className="flex flex-wrap gap-2">
          {ORIENTATIONS.map(id => (
            <FilterToggle key={id} pressed={orientations.includes(id)} onClick={() => toggleOrientation(id)}>
              {orientationLabels[id]}
            </FilterToggle>
          ))}
        </div>
      </Section>

      <Section title="Format">
        {[...FORMAT_GROUPS, { kind: null, title: 'Other' }].map(({ kind, title }) => {
          const entries = formatEntries.filter(entry => (kind ? entry.mediaType === kind : !FORMAT_GROUPS.some(group => group.kind === entry.mediaType)));
          if (entries.length === 0) return null;
          return (
            <div key={kind ?? 'other'} className="mb-2 last:mb-0">
              <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">{title}</p>
              <div className="flex flex-wrap gap-2">
                {entries.map(entry => (
                  <FilterToggle key={entry.id} pressed={formats.includes(entry.id)} onClick={() => toggleFormat(entry.id)}>
                    {entry.label}{entry.count != null ? ` (${formatCount(entry.count)})` : ''}
                  </FilterToggle>
                ))}
              </div>
            </div>
          );
        })}
        {!options && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{optionsError ? 'Formats unavailable' : 'Loading formats...'}</p>
        )}
        {options && formatEntries.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">No formats found</p>
        )}
      </Section>

      <Section title="Duplicates">
        <div className="flex flex-wrap gap-2">
          {DUPLICATE_KINDS.map(kind => {
            const count = options?.duplicates?.[kind];
            return (
              <FilterToggle key={kind} pressed={duplicates.includes(kind)} onClick={() => toggleDuplicate(kind)}>
                {duplicateLabels[kind]}{typeof count === 'number' ? ` (${formatCount(count)})` : ''}
              </FilterToggle>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Copies and look-alikes anywhere in your library. The first look-alike check after indexing can take a few seconds.
        </p>
      </Section>

      <Section title="Minimum resolution">
        <div className="flex flex-wrap gap-2">
          <FilterToggle pressed={!minMegapixels} onClick={() => setMinMegapixels(null)}>Any</FilterToggle>
          {MEGAPIXEL_CHOICES.map(value => (
            <FilterToggle key={value} pressed={minMegapixels === value} onClick={() => setMinMegapixels(value)}>
              {value} MP
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {options?.registry_available !== false && (
            <button
              type="button"
              onClick={readDetailsNow}
              disabled={isStartingScan || scanActive}
              className={cn(
                'px-3 py-1.5 rounded-xl border text-xs font-semibold disabled:opacity-50 cursor-pointer',
                missingDetails > 0
                  ? 'border-indigo-600 bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800'
              )}
            >
              Read details now
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={activeCount === 0}
              className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={close}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
