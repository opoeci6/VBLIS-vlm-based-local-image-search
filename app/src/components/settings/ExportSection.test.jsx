import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { ExportSection } from './ExportSection';

const COLLECTIONS = {
  active_model: 'org/model-b',
  collections: [
    { model_id: 'org/model-a', records: 1234 },
    { model_id: 'org/model-b', records: 27191 },
  ],
};
const ONE = { active_model: 'org/model-a', collections: [{ model_id: 'org/model-a', records: 27191 }] };
const NONE = { active_model: null, collections: [] };
const STARTED = { status: 'queued', task: { id: 7, type: 'EXPORT_INDEX', title: 'Export index' }, output_path: 'D:\\out\\VBLIS.vblis-export' };

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('ExportSection', () => {
  let routes;
  let fetchMock;
  let setToast;

  const requests = (route) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method || 'GET'} ${new URL(String(url)).pathname}` === route)
    .map(([, init]) => ({ init, body: init?.body ? JSON.parse(init.body) : undefined }));

  const renderSection = async (collections = COLLECTIONS, uiTheme = 'modern') => {
    routes['GET /index/export/collections'] = () => reply(collections);
    const view = render(<ExportSection uiTheme={uiTheme} setToast={setToast} />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    return view;
  };

  const exportButton = () => screen.getByRole('button', { name: 'Export…' });

  beforeEach(() => {
    setToast = vi.fn();
    routes = {};
    fetchMock = vi.fn(async (url, init) => {
      const key = `${init?.method || 'GET'} ${new URL(String(url)).pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`unexpected ${key}`);
      return handler(init);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    delete window.electronAPI;
    vi.unstubAllGlobals();
  });

  describe('loading', () => {
    it('shows the heading and the explanation, then reads the collections once', async () => {
      routes['GET /index/export/collections'] = () => reply(ONE);
      render(<ExportSection uiTheme="modern" setToast={setToast} />);
      expect(screen.getByRole('heading', { name: 'Export for another device' })).toBeTruthy();
      expect(screen.getByText(/Copy this library's index to another computer/).textContent).toContain('so keep it private.');
      expect(screen.getByRole('status').textContent).toBe('Checking what can be exported...');
      await screen.findByText('27,191 items');
      expect(requests('GET /index/export/collections')).toHaveLength(1);
    });

    it('says so when the collections cannot be loaded and retries', async () => {
      routes['GET /index/export/collections'] = () => reply({ detail: 'x' }, 500);
      render(<ExportSection uiTheme="modern" setToast={setToast} />);
      expect((await screen.findByRole('alert')).textContent).toBe('Could not check what can be exported.');
      routes['GET /index/export/collections'] = () => reply(ONE);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByText('27,191 items');
      expect(requests('GET /index/export/collections')).toHaveLength(2);
    });
  });

  describe('what to export', () => {
    it('shows the count of the one index, with no model choice', async () => {
      await renderSection(ONE);
      expect(screen.getByText('27,191 items')).toBeTruthy();
      expect(screen.queryByText('Index to export')).toBeNull();
    });

    it('says "1 item" for a single record', async () => {
      await renderSection({ active_model: 'org/model-a', collections: [{ model_id: 'org/model-a', records: 1 }] });
      expect(screen.getByText('1 item')).toBeTruthy();
    });

    it('offers each model and starts on the active one', async () => {
      await renderSection();
      expect(screen.getByText('Index to export')).toBeTruthy();
      expect(screen.getByRole('button', { name: /org\/model-b/ })).toBeTruthy();
      expect(screen.getByText('27,191 items')).toBeTruthy();
    });

    it('falls back to the first model when none is active', async () => {
      await renderSection({ ...COLLECTIONS, active_model: null });
      expect(screen.getByRole('button', { name: /org\/model-a/ })).toBeTruthy();
      expect(screen.getByText('1,234 items')).toBeTruthy();
    });

    it('shows the count of the chosen model and exports that one', async () => {
      window.electronAPI = { saveFile: vi.fn().mockResolvedValue('D:\\out\\VBLIS.vblis-export') };
      routes['POST /index/export'] = () => reply(STARTED);
      await renderSection();
      fireEvent.click(screen.getByRole('button', { name: /org\/model-b/ }));
      fireEvent.click(screen.getByRole('button', { name: 'org/model-a' }));
      expect(screen.getByText('1,234 items')).toBeTruthy();

      fireEvent.click(exportButton());
      await waitFor(() => expect(requests('POST /index/export')).toHaveLength(1));
      expect(requests('POST /index/export')[0].body.model_id).toBe('org/model-a');
    });

    it('shows nothing to export and no button when no index has records', async () => {
      await renderSection(NONE);
      expect(screen.getByText('Nothing to export yet: index a folder first.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
    });
  });

  describe('exporting with the save dialog', () => {
    it('asks for an export file, sends the request and says it started', async () => {
      const saveFile = vi.fn().mockResolvedValue('D:\\out\\VBLIS-2026-11-20.vblis-export');
      window.electronAPI = { saveFile };
      routes['POST /index/export'] = () => reply(STARTED);
      await renderSection(ONE);

      fireEvent.click(exportButton());
      await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
      expect(saveFile).toHaveBeenCalledWith('export');
      expect(setToast).toHaveBeenCalledWith({ message: 'Export started. It appears in the task queue.', type: 'success' });

      const [post] = requests('POST /index/export');
      expect(post.init.headers['Content-Type']).toBe('application/json');
      expect(post.body).toEqual({ output_path: 'D:\\out\\VBLIS-2026-11-20.vblis-export', model_id: 'org/model-a', thumbnails: true });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('includes the thumbnails by default and leaves them out when unchecked', async () => {
      window.electronAPI = { saveFile: vi.fn().mockResolvedValue('D:\\out\\a.vblis-export') };
      routes['POST /index/export'] = () => reply(STARTED);
      await renderSection(ONE);
      const checkbox = screen.getByRole('checkbox', { name: 'Include thumbnails (larger file, faster browsing on the other device)' });
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      fireEvent.click(exportButton());
      await waitFor(() => expect(requests('POST /index/export')).toHaveLength(1));
      expect(requests('POST /index/export')[0].body.thumbnails).toBe(false);
    });

    it('sends nothing when the dialog is cancelled', async () => {
      const saveFile = vi.fn().mockResolvedValue(null);
      window.electronAPI = { saveFile };
      await renderSection(ONE);

      fireEvent.click(exportButton());
      await waitFor(() => expect(saveFile).toHaveBeenCalled());
      await waitFor(() => expect(exportButton().disabled).toBe(false));
      expect(requests('POST /index/export')).toHaveLength(0);
      expect(setToast).not.toHaveBeenCalled();
    });

    it('does not show the path field when there is a dialog', async () => {
      window.electronAPI = { saveFile: vi.fn() };
      await renderSection(ONE);
      expect(screen.queryByLabelText('Save the file as')).toBeNull();
    });

    it('disables the button while the request is in flight', async () => {
      window.electronAPI = { saveFile: vi.fn().mockResolvedValue('D:\\out\\a.vblis-export') };
      let answer;
      routes['POST /index/export'] = () => new Promise((resolve) => { answer = () => resolve(reply(STARTED)); });
      await renderSection(ONE);

      fireEvent.click(exportButton());
      await waitFor(() => expect(requests('POST /index/export')).toHaveLength(1));
      expect(exportButton().disabled).toBe(true);
      fireEvent.click(exportButton());
      expect(requests('POST /index/export')).toHaveLength(1);

      answer();
      await waitFor(() => expect(exportButton().disabled).toBe(false));
      expect(setToast).toHaveBeenCalledTimes(1);
    });
  });

  describe('exporting without a dialog (the dev page)', () => {
    it('takes a typed path, and the button waits for one', async () => {
      routes['POST /index/export'] = () => reply(STARTED);
      await renderSection(ONE);
      expect(exportButton().disabled).toBe(true);

      fireEvent.change(screen.getByLabelText('Save the file as'), { target: { value: '  D:\\out\\typed.vblis-export  ' } });
      expect(exportButton().disabled).toBe(false);
      fireEvent.click(exportButton());
      await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
      expect(requests('POST /index/export')[0].body).toEqual({ output_path: 'D:\\out\\typed.vblis-export', model_id: 'org/model-a', thumbnails: true });
    });
  });

  describe('refusals', () => {
    const refuse = async (code, detail) => {
      window.electronAPI = { saveFile: vi.fn().mockResolvedValue('D:\\out\\a.vblis-export') };
      routes['POST /index/export'] = () => reply({ detail, code }, 400);
      await renderSection(ONE);
      fireEvent.click(exportButton());
      return screen.findByRole('alert');
    };

    it.each([
      ['invalid_path', "That location can't be used. Choose another file name or folder."],
      ['unknown_model', "That index isn't available any more. Close Settings, open them again and choose another."],
      ['no_index', 'Nothing to export yet: index a folder first.'],
    ])('explains %s in its own words', async (code, text) => {
      const alert = await refuse(code, 'backend wording');
      expect(alert.textContent).toBe(text);
      expect(setToast).not.toHaveBeenCalled();
      expect(exportButton().disabled).toBe(false);
    });

    it('shows the backend detail for a code it has no translation for', async () => {
      expect((await refuse('disk_full', 'Not enough space on D:.')).textContent).toBe('Not enough space on D:.');
    });

    it('clears the message when the next export starts', async () => {
      await refuse('invalid_path', 'x');
      routes['POST /index/export'] = () => reply(STARTED);
      fireEvent.click(exportButton());
      await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('the two interface styles', () => {
    it('shows a custom select in the modern style and a native one in the terminal style', async () => {
      const { unmount } = await renderSection(COLLECTIONS, 'modern');
      expect(document.querySelector('select')).toBeNull();
      expect(screen.getByRole('button', { name: /org\/model-b/ })).toBeTruthy();
      unmount();

      await renderSection(COLLECTIONS, 'terminal');
      const select = screen.getByLabelText('Index to export');
      expect(select.tagName).toBe('SELECT');
      expect(select.value).toBe('org/model-b');
      expect(screen.getByText('27,191 items')).toBeTruthy();
      fireEvent.change(select, { target: { value: 'org/model-a' } });
      expect(screen.getByText('1,234 items')).toBeTruthy();
      expect(exportButton()).toBeTruthy();
    });

    it('renders the empty state in the terminal style', async () => {
      await renderSection(NONE, 'terminal');
      expect(screen.getByText('Nothing to export yet: index a folder first.')).toBeTruthy();
    });
  });

  describe('Chinese', () => {
    it('is translated', async () => {
      await i18n.changeLanguage('zh-CN');
      window.electronAPI = { saveFile: vi.fn().mockResolvedValue('D:\\out\\a.vblis-export') };
      routes['POST /index/export'] = () => reply({ detail: 'x', code: 'invalid_path' }, 400);
      await renderSection(ONE);
      expect(screen.getByRole('heading', { name: '导出到其他设备' })).toBeTruthy();
      expect(screen.getByText('27,191 项')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '导出……' }));
      expect((await screen.findByRole('alert')).textContent).toBe('无法使用该位置。请换一个文件名或文件夹。');
    });
  });
});
