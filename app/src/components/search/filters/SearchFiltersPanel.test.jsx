import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSearchFilters } from '../../../hooks/useSearchFilters';
import { SearchFiltersPanel } from './SearchFiltersPanel';

const API = 'http://127.0.0.1:8000';

const OPTIONS = {
  total_files: 100,
  with_details: 80,
  unavailable: 5,
  missing_details: 15,
  media_types: { image: 90, video: 10 },
  formats: [
    { id: 'jpeg', label: 'JPEG', media_type: 'image', count: 70 },
    { id: 'heic', label: 'HEIC', media_type: 'image', count: 20 },
    { id: 'mp4', label: 'MP4', media_type: 'video', count: 10 },
  ],
  years: [{ year: 2024, count: 1203 }, { year: 2023, count: 40 }],
  date_range: { from: '2023-01-01', to: '2024-12-31' },
  registry_available: true,
};

const FOLDERS = [
  {
    path: 'C:\\Photos', name: 'Photos', exists: true, image_count: 5, video_count: 0, item_count: 5,
    subfolders: [
      { path: 'C:\\Photos\\2024', name: '2024', relative_path: '2024', depth: 1, exists: true, image_count: 3, video_count: 0 },
      { path: 'C:\\Photos\\2023', name: '2023', relative_path: '2023', depth: 1, exists: true, image_count: 2, video_count: 0 },
    ],
  },
  { path: 'E:\\Backup', name: 'Backup', exists: false, image_count: 7, video_count: 1, item_count: 8, subfolders: [] },
];

const MISSING_NOTE = '15 files have no media details yet. Date, orientation and resolution filters skip them until their details are read. That reads file headers only; no re-indexing.';

const jsonResponse = (body) => ({ ok: true, json: async () => body });

// Real filters hook behind the panel and a stand-in for the header's Filters button.
const Harness = ({ indexedFolders = FOLDERS, setToast = () => {}, latest }) => {
  const filters = useSearchFilters({ setToast });
  latest.current = filters;
  return (
    <div>
      <button type="button" data-filters-toggle="true" onClick={filters.toggleOpen}>filters-toggle</button>
      <div data-testid="outside">outside</div>
      <SearchFiltersPanel filters={filters} indexedFolders={indexedFolders} />
    </div>
  );
};

describe('SearchFiltersPanel', () => {
  let fetchMock;
  let options;
  let latest;

  beforeEach(() => {
    options = OPTIONS;
    latest = { current: null };
    fetchMock = vi.fn(async (url) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/search/filter-options') return jsonResponse(options);
      if (pathname === '/index/media-info/scan') return jsonResponse({ status: 'queued', task_id: 't1' });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderPanel = async (props = {}) => {
    const utils = render(<Harness latest={latest} {...props} />);
    fireEvent.click(screen.getByText('filters-toggle'));
    await screen.findByRole('dialog', { name: 'Search filters' });
    await waitFor(() => expect(latest.current.options).not.toBeNull());
    return utils;
  };

  const inRegion = (title) => within(screen.getByRole('region', { name: title }));
  const pressed = (name, title) => (title ? inRegion(title) : screen).getByRole('button', { name }).getAttribute('aria-pressed');

  it('renders nothing while closed and does not load the options', () => {
    render(<Harness latest={latest} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens as a non-modal dialog with every section and loads the options', async () => {
    await renderPanel();
    const dialog = screen.getByRole('dialog', { name: 'Search filters' });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    ['Type', 'Folders', 'Date taken', 'Orientation', 'Format', 'Minimum resolution'].forEach(title => {
      expect(within(dialog).getByRole('region', { name: title })).toBeTruthy();
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === `${API}/search/filter-options`)).toBe(true);
  });

  describe('type', () => {
    it('selects one media type at a time', async () => {
      await renderPanel();
      expect(pressed('All')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: 'Videos' }));
      expect(pressed('Videos')).toBe('true');
      expect(pressed('All')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ media_type: 'video' });

      fireEvent.click(screen.getByRole('button', { name: 'Images' }));
      expect(pressed('Videos')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ media_type: 'image' });

      fireEvent.click(screen.getByRole('button', { name: 'All' }));
      expect(latest.current.requestFilters).toBeNull();
    });
  });

  describe('date', () => {
    it('offers one toggle per year with its count and sets the range', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: '2024 (1,203)' }));
      expect(pressed('2024 (1,203)')).toBe('true');
      expect(pressed('Any', 'Date taken')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ date_from: '2024-01-01', date_to: '2024-12-31' });

      fireEvent.click(screen.getByRole('button', { name: '2023 (40)' }));
      expect(pressed('2024 (1,203)')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ date_from: '2023-01-01', date_to: '2023-12-31' });
    });

    it('sets the relative presets', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
      expect(pressed('Last 30 days')).toBe('true');
      expect(latest.current.requestFilters.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }));
      expect(pressed('Last 30 days')).toBe('false');
      expect(pressed('Last 12 months')).toBe('true');
      fireEvent.click(inRegion('Date taken').getByRole('button', { name: 'Any' }));
      expect(latest.current.requestFilters).toBeNull();
    });

    it('shows the custom date inputs only for Custom and applies what is typed', async () => {
      await renderPanel();
      expect(document.querySelector('input[type="date"]')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Custom...' }));
      expect(pressed('Custom...')).toBe('true');
      const dateInputs = document.querySelectorAll('input[type="date"]');
      expect(dateInputs).toHaveLength(2);

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-01' } });
      expect(latest.current.requestFilters).toEqual({ date_from: '2024-01-01' });
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-03-31' } });
      expect(latest.current.requestFilters).toEqual({ date_from: '2024-01-01', date_to: '2024-03-31' });
      expect(screen.getByLabelText('From').value).toBe('2024-01-01');

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
      expect(latest.current.requestFilters).toEqual({ date_to: '2024-03-31' });
    });
  });

  describe('orientation, format and resolution', () => {
    it('toggles several orientations independently', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
      fireEvent.click(screen.getByRole('button', { name: 'Square' }));
      expect(pressed('Portrait')).toBe('true');
      expect(pressed('Square')).toBe('true');
      expect(pressed('Landscape')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ orientations: ['portrait', 'square'] });

      fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
      expect(pressed('Portrait')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ orientations: ['square'] });
    });

    it('lists the formats present with their counts, grouped by media type', async () => {
      await renderPanel();
      const region = screen.getByRole('region', { name: 'Format' });
      expect(within(region).getByText('Images')).toBeTruthy();
      expect(within(region).getByText('Videos')).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'JPEG (70)' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'HEIC (20)' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'MP4 (10)' })).toBeTruthy();
      expect(within(region).queryByRole('button', { name: /PNG/ })).toBeNull();

      fireEvent.click(within(region).getByRole('button', { name: 'HEIC (20)' }));
      fireEvent.click(within(region).getByRole('button', { name: 'MP4 (10)' }));
      expect(pressed('HEIC (20)')).toBe('true');
      expect(latest.current.requestFilters).toEqual({ formats: ['heic', 'mp4'] });
    });

    it('offers no format until the options arrive', async () => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      render(<Harness latest={latest} />);
      fireEvent.click(screen.getByText('filters-toggle'));
      const region = await screen.findByRole('region', { name: 'Format' });
      expect(within(region).queryAllByRole('button')).toHaveLength(0);
      expect(within(region).getByText('Loading formats...')).toBeTruthy();
      expect(screen.getByText('Loading filter options...')).toBeTruthy();
    });

    it('renders a format the backend reports that the app has no label for', async () => {
      options = { ...OPTIONS, formats: [...OPTIONS.formats, { id: 'avif', label: 'AVIF', media_type: 'image', count: 3 }] };
      await renderPanel();
      const region = inRegion('Format');
      fireEvent.click(region.getByRole('button', { name: 'AVIF (3)' }));
      expect(latest.current.requestFilters).toEqual({ formats: ['avif'] });
      expect(latest.current.chips.map(chip => chip.label)).toEqual(['AVIF']);
    });

    it('keeps a selected format visible when the index no longer has it', async () => {
      await renderPanel();
      fireEvent.click(inRegion('Format').getByRole('button', { name: 'HEIC (20)' }));
      options = { ...OPTIONS, formats: [OPTIONS.formats[0]] };
      await act(async () => { await latest.current.loadOptions(); });
      const stale = inRegion('Format').getByRole('button', { name: 'HEIC' });
      expect(stale.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(stale);
      expect(latest.current.requestFilters).toBeNull();
    });

    it('selects a minimum resolution', async () => {
      await renderPanel();
      expect(pressed('Any', 'Minimum resolution')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: '12 MP' }));
      expect(pressed('12 MP')).toBe('true');
      expect(latest.current.requestFilters).toEqual({ min_megapixels: 12 });
      fireEvent.click(screen.getByRole('button', { name: '2 MP' }));
      expect(pressed('12 MP')).toBe('false');
      expect(latest.current.requestFilters).toEqual({ min_megapixels: 2 });
    });
  });

  describe('folders', () => {
    it('says so when nothing is indexed', async () => {
      await renderPanel({ indexedFolders: [] });
      expect(screen.getByText('No indexed folders')).toBeTruthy();
    });

    it('lists the roots with their item counts and marks missing ones', async () => {
      await renderPanel();
      const photos = screen.getByRole('button', { name: /^Photos/ });
      expect(photos.textContent).toContain('5');
      expect(photos.textContent).not.toContain('Missing');
      const backup = screen.getByRole('button', { name: /^Backup/ });
      expect(backup.textContent).toContain('Missing');
      expect(backup.textContent).toContain('8');
      expect(backup.getAttribute('title')).toBe('Backup is missing or inaccessible on disk');
      expect(within(backup).getByText('Backup').className).toContain('text-rose-600');
      expect(within(backup).getByText('Missing').className).toContain('text-rose-500');
    });

    it('does not select a missing folder', async () => {
      await renderPanel();
      const backup = screen.getByRole('button', { name: /^Backup/ });
      expect(backup.getAttribute('aria-disabled')).toBe('true');
      expect(backup.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(backup);
      expect(latest.current.folders).toEqual([]);
      expect(latest.current.requestFilters).toBeNull();
    });

    it('keeps a missing folder that was already selected pressed and lets it be deselected', async () => {
      await renderPanel();
      // Chosen while its drive was still connected.
      act(() => latest.current.toggleFolder('E:\\Backup'));
      const backup = screen.getByRole('button', { name: /^Backup/ });
      expect(backup.getAttribute('aria-pressed')).toBe('true');
      expect(backup.getAttribute('aria-disabled')).toBeNull();

      fireEvent.click(backup);
      expect(latest.current.folders).toEqual([]);
      expect(screen.getByRole('button', { name: /^Backup/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('styles a missing row that is not selected like the folder explorer and blocks the cursor', async () => {
      await renderPanel();
      const backup = screen.getByRole('button', { name: /^Backup/ });
      for (const cls of ['border-rose-200', 'dark:border-rose-500/30', 'bg-rose-50/50', 'dark:bg-rose-500/5', 'hover:bg-rose-50/50', 'dark:hover:bg-rose-500/5', 'cursor-not-allowed']) {
        expect(backup.className).toContain(cls);
      }
      expect(backup.className).not.toContain('hover:bg-gray-50');
      expect(backup.className).not.toContain('border-gray-200');
      expect(backup.className).not.toContain('cursor-pointer');
    });

    it('keeps the pressed look and a pointer cursor on a missing row that is still selected', async () => {
      await renderPanel();
      act(() => latest.current.toggleFolder('E:\\Backup'));
      const backup = screen.getByRole('button', { name: /^Backup/ });
      expect(backup.className).toContain('bg-indigo-50');
      expect(backup.className).toContain('border-indigo-300');
      expect(backup.className).toContain('cursor-pointer');
      expect(backup.className).not.toContain('cursor-not-allowed');
      expect(backup.className).not.toContain('bg-rose-50');
      expect(backup.className).not.toContain('border-rose-200');
    });

    it('leaves connected rows and included rows as they were', async () => {
      await renderPanel();
      const photos = screen.getByRole('button', { name: /^Photos/ });
      expect(photos.className).toContain('cursor-pointer');
      expect(photos.className).toContain('hover:bg-gray-50');
      expect(photos.className).not.toContain('rose');

      fireEvent.click(photos);
      fireEvent.click(screen.getByRole('button', { name: 'Expand Photos' }));
      const included = inRegion('Folders').getByRole('button', { name: /^2024/ });
      expect(included.getAttribute('aria-disabled')).toBe('true');
      expect(included.className).toContain('cursor-default');
      expect(included.className).not.toContain('rose');
    });

    it('lists missing roots after the connected ones, keeping the order within each group', async () => {
      const root = (name, exists) => ({ path: `D:\\${name}`, name, exists, image_count: 1, video_count: 0, item_count: 1, subfolders: [] });
      await renderPanel({ indexedFolders: [root('Gone1', false), root('Zeta', true), root('Gone2', false), root('Alpha', true)] });
      const names = within(inRegion('Folders').getByRole('list')).getAllByRole('button').map(b => b.textContent.replace(/Missing|\d+$/g, ''));
      expect(names).toEqual(['Zeta', 'Alpha', 'Gone1', 'Gone2']);
    });

    it('treats missing subfolders the same way and lists them last', async () => {
      const folders = [{
        path: 'D:\\Root', name: 'Root', exists: true, image_count: 1, video_count: 0, item_count: 3,
        subfolders: [
          { path: 'D:\\Root\\a', name: 'a', relative_path: 'a', depth: 1, exists: false, image_count: 1, video_count: 0 },
          { path: 'D:\\Root\\b', name: 'b', relative_path: 'b', depth: 1, exists: true, image_count: 1, video_count: 0 },
        ],
      }];
      await renderPanel({ indexedFolders: folders });
      fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
      const rows = inRegion('Folders').getAllByRole('button').filter(button => /^[ab]/.test(button.textContent));
      expect(rows.map(row => row.textContent.replace(/\d+$/, ''))).toEqual(['b', 'aMissing']);

      fireEvent.click(rows[1]);
      expect(latest.current.folders).toEqual([]);
      fireEvent.click(rows[0]);
      expect(latest.current.folders).toEqual(['D:\\Root\\b']);
    });

    it('selects a root folder', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /^Photos/ }));
      expect(screen.getByRole('button', { name: /^Photos/ }).getAttribute('aria-pressed')).toBe('true');
      expect(latest.current.requestFilters).toEqual({ folders: ['C:\\Photos'] });
    });

    it('expands a root to show its subfolders', async () => {
      await renderPanel();
      expect(inRegion('Folders').queryByRole('button', { name: /^2024/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Photos' }));
      expect(screen.getByRole('button', { name: 'Collapse Photos' }).getAttribute('aria-expanded')).toBe('true');
      expect(inRegion('Folders').getByRole('button', { name: /^2024/ })).toBeTruthy();
      expect(inRegion('Folders').getByRole('button', { name: /^2023/ })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Collapse Photos' }));
      expect(inRegion('Folders').queryByRole('button', { name: /^2024/ })).toBeNull();
    });

    it('shows subfolders of a selected folder as included and ignores clicks on them', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Photos' }));
      fireEvent.click(inRegion('Folders').getByRole('button', { name: /^2024/ }));
      expect(latest.current.folders).toEqual(['C:\\Photos\\2024']);

      // Selecting the root replaces the selected subfolder.
      fireEvent.click(screen.getByRole('button', { name: /^Photos/ }));
      expect(latest.current.folders).toEqual(['C:\\Photos']);

      const child = inRegion('Folders').getByRole('button', { name: /^2024/ });
      expect(child.getAttribute('aria-pressed')).toBe('true');
      expect(child.getAttribute('aria-disabled')).toBe('true');
      expect(child.textContent).toContain('(included)');

      fireEvent.click(child);
      expect(latest.current.folders).toEqual(['C:\\Photos']);

      fireEvent.click(screen.getByRole('button', { name: /^Photos/ }));
      expect(latest.current.folders).toEqual([]);
      expect(inRegion('Folders').getByRole('button', { name: /^2024/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('compacts a chain of folders without files of their own into one row', async () => {
      const folders = [{
        path: 'C:\\Lib', name: 'Lib', exists: true, image_count: 0, video_count: 0, item_count: 4,
        subfolders: [
          { path: 'C:\\Lib\\a', name: 'a', relative_path: 'a', depth: 1, exists: true, image_count: 0, video_count: 0 },
          { path: 'C:\\Lib\\a\\b', name: 'b', relative_path: 'a\\b', depth: 2, exists: true, image_count: 4, video_count: 0 },
        ],
      }];
      await renderPanel({ indexedFolders: folders });
      fireEvent.click(screen.getByRole('button', { name: 'Expand Lib' }));
      const row = screen.getByRole('button', { name: /^a \/ b/ });
      fireEvent.click(row);
      expect(latest.current.folders).toEqual(['C:\\Lib\\a\\b']);
    });
  });

  describe('coverage', () => {
    it('shows how many files have media details and those in disconnected folders', async () => {
      await renderPanel();
      expect(screen.getByText("Media details for 80 of 100 files (5 in folders that aren't connected)")).toBeTruthy();
      const coverage = screen.getByTestId('filters-coverage');
      expect(coverage.getAttribute('data-warning')).toBe('false');
      expect(screen.queryByText(/hidden by the date, orientation and resolution filters/)).toBeNull();
    });

    it('leaves out the disconnected note when there is none', async () => {
      options = { ...OPTIONS, unavailable: 0 };
      await renderPanel();
      expect(screen.getByText('Media details for 80 of 100 files')).toBeTruthy();
    });

    it.each([
      ['a date', () => fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))],
      ['an orientation', () => fireEvent.click(screen.getByRole('button', { name: 'Square' }))],
      ['a minimum resolution', () => fireEvent.click(screen.getByRole('button', { name: '8 MP' }))],
    ])('warns that files without details are skipped once %s filter is active', async (_name, activate) => {
      await renderPanel();
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('false');
      activate();
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('true');
      expect(screen.getByText(MISSING_NOTE)).toBeTruthy();
    });

    it('shows the missing-details note as a plain note while no such filter is active', async () => {
      await renderPanel();
      expect(screen.getByText(MISSING_NOTE)).toBeTruthy();
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('false');
    });

    it('falls back to total - with details - unavailable when missing_details is absent', async () => {
      const { missing_details: _ignored, ...withoutKey } = OPTIONS;
      options = withoutKey;
      await renderPanel();
      expect(screen.getByText(MISSING_NOTE)).toBeTruthy();
    });

    it('shows no missing-details note when every file has details or is just unavailable', async () => {
      options = { ...OPTIONS, with_details: 95, unavailable: 5, missing_details: 0 };
      await renderPanel();
      expect(screen.queryByText(/have no media details yet/)).toBeNull();
    });

    it('makes Read details now the primary button only while details are missing', async () => {
      await renderPanel();
      expect(screen.getByRole('button', { name: 'Read details now' }).className).toContain('bg-indigo-600');
      options = { ...OPTIONS, with_details: 95, unavailable: 5, missing_details: 0 };
      await act(async () => { await latest.current.loadOptions(); });
      expect(screen.getByRole('button', { name: 'Read details now' }).className).not.toContain('bg-indigo-600');
    });

    it('does not warn for filters that do not need media details', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Images' }));
      fireEvent.click(screen.getByRole('button', { name: 'JPEG (70)' }));
      fireEvent.click(screen.getByRole('button', { name: /^Photos/ }));
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('false');
    });

    it('does not warn when every file has details', async () => {
      options = { ...OPTIONS, with_details: 100, unavailable: 0, missing_details: 0 };
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Square' }));
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('false');
    });

    it('does not warn when only files in folders that are not connected lack details', async () => {
      options = { ...OPTIONS, with_details: 95, unavailable: 5, missing_details: 0 };
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Square' }));
      expect(screen.getByTestId('filters-coverage').getAttribute('data-warning')).toBe('false');
      expect(screen.queryByText(/hidden by the date, orientation and resolution filters/)).toBeNull();
    });

    it('says media details are unavailable when the registry is', async () => {
      options = { ...OPTIONS, registry_available: false };
      await renderPanel();
      expect(screen.getByText('Media details are unavailable')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Read details now' })).toBeNull();
    });

    it('starts reading media details in the background', async () => {
      const setToast = vi.fn();
      await renderPanel({ setToast });
      fireEvent.click(screen.getByRole('button', { name: 'Read details now' }));
      await waitFor(() => expect(setToast).toHaveBeenCalledWith({ message: 'Reading media details in the background', type: 'info' }));
      const scan = fetchMock.mock.calls.find(([url]) => String(url) === `${API}/index/media-info/scan`);
      expect(scan[1].method).toBe('POST');
    });

    it('shows a retry when the options cannot be loaded', async () => {
      fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
      render(<Harness latest={latest} />);
      fireEvent.click(screen.getByText('filters-toggle'));
      expect(await screen.findByText(/Could not load the filter options/)).toBeTruthy();

      fetchMock.mockImplementation(async () => jsonResponse(OPTIONS));
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText(/Media details for 80 of 100 files/)).toBeTruthy();
    });
  });

  describe('closing and clearing', () => {
    it('closes on Escape', async () => {
      await renderPanel();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on a mousedown outside, but not inside or on the Filters button', async () => {
      await renderPanel();
      fireEvent.mouseDown(screen.getByRole('dialog'));
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Images' }));
      fireEvent.mouseDown(screen.getByText('filters-toggle'));
      expect(screen.getByRole('dialog')).toBeTruthy();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes with Done and with the close button, keeping the filters', async () => {
      await renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Images' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(latest.current.requestFilters).toEqual({ media_type: 'image' });

      fireEvent.click(screen.getByText('filters-toggle'));
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('clears all filters, and the button is disabled when none is active', async () => {
      await renderPanel();
      const clear = screen.getByRole('button', { name: 'Clear all' });
      expect(clear.disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Images' }));
      fireEvent.click(screen.getByRole('button', { name: '8 MP' }));
      expect(clear.disabled).toBe(false);
      fireEvent.click(clear);
      expect(latest.current.requestFilters).toBeNull();
      expect(pressed('All')).toBe('true');
    });

    it('reloads the options when a background task finishes while open', async () => {
      const Wrapper = ({ taskId }) => {
        const filters = useSearchFilters({ setToast: () => {}, activeTaskId: taskId });
        latest.current = filters;
        return <SearchFiltersPanel filters={filters} indexedFolders={[]} />;
      };
      const { rerender } = render(<Wrapper taskId="t1" />);
      await act(async () => { latest.current.open(); });
      const optionCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/search/filter-options')).length;
      expect(optionCalls()).toBe(1);

      await act(async () => { rerender(<Wrapper taskId={null} />); });
      expect(optionCalls()).toBe(2);
    });
  });
});
