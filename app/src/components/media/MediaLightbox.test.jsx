import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { MediaLightbox } from './MediaLightbox';
import { formatTakenDate } from '../../utils/formatters';

const API = 'http://127.0.0.1:8000';

const renderLightbox = (selectedImage, overrides = {}) => {
  const props = {
    selectedImage,
    setSelectedImage: vi.fn(),
    setToast: vi.fn(),
    uiTheme: 'modern',
    ...overrides,
  };
  return { props, ...render(<MediaLightbox {...props} />) };
};

const imageResult = (extra = {}) => ({ path: '/pics/a.jpg', media_type: 'image', score: 0.874, ...extra });

describe('MediaLightbox', () => {
  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  it('renders nothing without a selection', () => {
    const { container } = renderLightbox(null);
    expect(container.firstChild).toBeNull();
  });

  it('loads the full-size image and shows the path and score', () => {
    renderLightbox(imageResult());
    const img = screen.getByAltText('Full size result');
    expect(img.getAttribute('src')).toBe(`${API}/image?path=%2Fpics%2Fa.jpg&size=full`);
    expect(screen.getByText('Match Score: 87%')).toBeTruthy();
    expect(screen.getByText('/pics/a.jpg')).toBeTruthy();
  });

  it('labels similarity results as Similarity', () => {
    renderLightbox(imageResult({ score: 0.846, score_kind: 'similarity' }));
    expect(screen.getByText('Similarity: 84%')).toBeTruthy();
    expect(screen.queryByText(/Match Score/)).toBeNull();
  });

  it('shows the name and size (no score) for items opened from folder browsing', () => {
    renderLightbox({ path: '/pics/a.jpg', name: 'a.jpg', size: 1536, media_type: 'image', isBrowsing: true });
    expect(screen.getByText('a.jpg')).toBeTruthy();
    expect(screen.getByText('1.5 KB')).toBeTruthy();
    expect(screen.queryByText(/Match Score/)).toBeNull();
  });

  it('falls back to the file name from the path when browsing without a name', () => {
    renderLightbox({ path: 'C:\\pics\\b.jpg', media_type: 'image', isBrowsing: true });
    expect(screen.getByText('b.jpg')).toBeTruthy();
  });

  it('shows the video timestamp badge', () => {
    renderLightbox({ path: '/v/clip.mp4', media_type: 'video', score: 0.5, timestamp_seconds: 65 });
    expect(screen.getByText('Video frame at 1:05')).toBeTruthy();
    expect(screen.getByAltText('Video frame at 1:05').getAttribute('src')).toContain('timestamp=65');
  });

  describe('duplicate badge', () => {
    it.each(['modern', 'terminal'])('shows an exact copy badge in the %s theme', (uiTheme) => {
      renderLightbox(
        imageResult({ isDuplicate: true, duplicateType: 'exact', dupeColor: '#0078d4', otherPaths: ['/x/a.jpg', '/y/a.jpg'] }),
        { uiTheme }
      );
      expect(screen.getByText('Exact File Copy detected in 2 other locations')).toBeTruthy();
    });

    it.each(['modern', 'terminal'])('shows a visual duplicate badge in the %s theme', (uiTheme) => {
      renderLightbox(
        imageResult({ isDuplicate: true, duplicateType: 'visual', dupeColor: '#f59e0b', otherPaths: ['/x/a.jpg'] }),
        { uiTheme }
      );
      expect(screen.getByText('Visual Duplicate (98.5%+ Similarity) detected in 1 other location')).toBeTruthy();
    });
  });

  describe('"Also found at" links', () => {
    const duplicate = () => imageResult({
      isDuplicate: true, duplicateType: 'exact', dupeColor: '#0078d4', otherPaths: ['/x/a.jpg'],
    });

    it('lists the other paths as Explorer links in Electron', () => {
      window.electronAPI = { openInExplorer: vi.fn() };
      renderLightbox(duplicate());
      expect(screen.getByText('Also found at:')).toBeTruthy();
      expect(screen.getByTitle('Show /x/a.jpg in Explorer')).toBeTruthy();
    });

    it('lists the other paths as plain text outside Electron', () => {
      renderLightbox(duplicate());
      expect(screen.getByText('Also found at:')).toBeTruthy();
      expect(screen.getByText('/x/a.jpg')).toBeTruthy();
      expect(screen.queryByTitle('Show /x/a.jpg in Explorer')).toBeNull();
    });

    it('opens the other location in Explorer', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: true }) };
      const { props } = renderLightbox(duplicate());
      fireEvent.click(screen.getByTitle('Show /x/a.jpg in Explorer'));
      await waitFor(() => expect(window.electronAPI.openInExplorer).toHaveBeenCalledWith('/x/a.jpg'));
      expect(props.setToast).not.toHaveBeenCalled();
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('toasts the error from Electron on failure', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false, error: 'denied' }) };
      const { props } = renderLightbox(duplicate());
      fireEvent.click(screen.getByTitle('Show /x/a.jpg in Explorer'));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({ type: 'error', message: 'denied' }));
    });

    it('uses a default message when the failure has no error text', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false }) };
      const { props } = renderLightbox(duplicate());
      fireEvent.click(screen.getByTitle('Show /x/a.jpg in Explorer'));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({
        type: 'error', message: 'Failed to open file in explorer.',
      }));
    });
  });

  describe('Show in Explorer (top bar)', () => {
    it('is hidden outside Electron', () => {
      renderLightbox(imageResult());
      expect(screen.queryByText('Show in Explorer')).toBeNull();
    });

    it('toasts when the file was moved or deleted', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false }) };
      const { props } = renderLightbox(imageResult());
      fireEvent.click(screen.getByRole('button', { name: /Show in Explorer/ }));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({
        message: 'This file has been moved or deleted and is no longer available.',
        type: 'error',
      }));
      expect(window.electronAPI.openInExplorer).toHaveBeenCalledWith('/pics/a.jpg');
    });
  });

  describe('copy path', () => {
    it.each(['modern', 'terminal'])('copies the path and confirms with a toast (%s theme)', async (uiTheme) => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: true }) };
      const { props } = renderLightbox(imageResult(), { uiTheme });
      fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({ message: 'Path copied', type: 'success' }));
      expect(window.electronAPI.copyText).toHaveBeenCalledWith('/pics/a.jpg');
    });

    it('shows an error toast when the copy fails', async () => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: false, error: 'Nothing to copy.' }) };
      const { props } = renderLightbox(imageResult());
      fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({ message: 'Nothing to copy.', type: 'error' }));
    });

    it('does not close the lightbox', async () => {
      window.electronAPI = { copyText: vi.fn().mockResolvedValue({ success: true }) };
      const { props } = renderLightbox(imageResult());
      fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
      await waitFor(() => expect(props.setToast).toHaveBeenCalled());
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it.each(['modern', 'terminal'])('has a 40 px tap area on a phone (%s theme)', (uiTheme) => {
      // The button stays 24 px; an absolutely placed ::before, 8 px past each edge, takes the touch.
      renderLightbox(imageResult(), { uiTheme });
      const classes = screen.getByRole('button', { name: 'Copy path' }).className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['relative', 'max-sm:before:absolute', 'max-sm:before:-inset-2']));
    });
  });

  describe('closing', () => {
    it('closes on a backdrop click', () => {
      const { props, container } = renderLightbox(imageResult());
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });

    it('stays open when a drag from the path text ends on the backdrop', () => {
      const { props, container } = renderLightbox(imageResult());
      fireEvent.mouseDown(screen.getByText('/pics/a.jpg'));
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('closes on a press and release on the backdrop', () => {
      const { props, container } = renderLightbox(imageResult());
      fireEvent.mouseDown(container.firstChild);
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });

    it('does not close on an image click', () => {
      const { props } = renderLightbox(imageResult());
      fireEvent.click(screen.getByAltText('Full size result'));
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('closes with the close button', () => {
      const { props } = renderLightbox(imageResult());
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });
  });
});

describe('MediaLightbox place line', () => {
  afterEach(cleanup);

  const place = {
    id: 'JP.26.1857910',
    country: { en: 'Japan', zh: '日本' },
    region: { en: 'Kyoto Prefecture', zh: '京都府' },
    city: { en: 'Kyoto', zh: null },
  };

  it('shows the place small to large in English, under the score', () => {
    renderLightbox(imageResult({ place }));
    const line = screen.getByText('Kyoto, Kyoto Prefecture, Japan');
    expect(line.closest('p').getAttribute('title')).toBe('Place: Kyoto, Kyoto Prefecture, Japan');
    expect(line.closest('p').querySelector('svg')).not.toBeNull();
    const score = screen.getByText('Match Score: 87%');
    expect(score.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows it large to small in Chinese, with the English name where there is no Chinese one', async () => {
    renderLightbox(imageResult({ place }));
    await act(async () => { await i18n.changeLanguage('zh-CN'); });
    expect(screen.getByText('日本 · 京都府 · Kyoto')).toBeTruthy();
    expect(screen.queryByText('Kyoto, Kyoto Prefecture, Japan')).toBeNull();
    expect(screen.getByText('日本 · 京都府 · Kyoto').closest('p').getAttribute('title')).toBe('地点：日本 · 京都府 · Kyoto');
  });

  it('follows a language switch while it is open', async () => {
    renderLightbox(imageResult({ place: { ...place, city: { en: 'Kyoto', zh: '京都市' } } }));
    expect(screen.getByText('Kyoto, Kyoto Prefecture, Japan')).toBeTruthy();
    await act(async () => { await i18n.changeLanguage('zh-CN'); });
    expect(screen.getByText('日本 · 京都府 · 京都市')).toBeTruthy();
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByText('Kyoto, Kyoto Prefecture, Japan')).toBeTruthy();
  });

  it('shows only what is known', () => {
    renderLightbox(imageResult({ place: { id: 'JP', country: { en: 'Japan', zh: '日本' }, region: null, city: null } }));
    expect(screen.getByText('Japan')).toBeTruthy();
  });

  it('shows it on a library item without a score, below the date taken', () => {
    renderLightbox(imageResult({ score: null, score_kind: 'none', taken_at: '2024-03-12T10:00:00', place }));
    const taken = screen.getByText(`Taken ${formatTakenDate('2024-03-12T10:00:00')}`);
    const line = screen.getByText('Kyoto, Kyoto Prefecture, Japan');
    expect(taken.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sits above the video badge', () => {
    renderLightbox({ path: '/v/clip.mp4', media_type: 'video', score: 0.5, timestamp_seconds: 65, place });
    const line = screen.getByText('Kyoto, Kyoto Prefecture, Japan');
    const badge = screen.getByText(/Video frame at 1:05/);
    expect(line.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent without a place', () => {
    renderLightbox(imageResult());
    expect(document.querySelector('svg.lucide-map-pin')).toBeNull();
    expect(screen.queryByTitle(/^Place:/)).toBeNull();
  });

  it('is absent for a folder explorer item, which has no place', () => {
    renderLightbox({ path: '/pics/a.jpg', name: 'a.jpg', size: 1536, media_type: 'image', isBrowsing: true });
    expect(document.querySelector('svg.lucide-map-pin')).toBeNull();
    expect(screen.queryByTitle(/^Place:/)).toBeNull();
  });

  it('is absent when the place has no names at all', () => {
    renderLightbox(imageResult({ place: { id: 'JP', country: { en: null, zh: null }, region: null, city: null } }));
    expect(screen.queryByTitle(/^Place:/)).toBeNull();
  });
});

describe('MediaLightbox for an item without a score (library view)', () => {
  afterEach(cleanup);

  const libraryItem = (extra = {}) => imageResult({ score: null, score_kind: 'none', taken_at: '2024-03-12T10:00:00', ...extra });

  it('shows the date taken and no match score', () => {
    renderLightbox(libraryItem());
    expect(screen.getByText(`Taken ${formatTakenDate('2024-03-12T10:00:00')}`)).toBeTruthy();
    expect(screen.queryByText(/Match Score|Similarity/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('shows neither a score nor a date when the date is unknown', () => {
    renderLightbox(libraryItem({ taken_at: null }));
    expect(screen.queryByText(/Taken/)).toBeNull();
    expect(screen.queryByText(/Match Score|Similarity/)).toBeNull();
    expect(screen.getByText('/pics/a.jpg')).toBeTruthy();
  });

  it('shows the date for a video frame too', () => {
    renderLightbox(libraryItem({ media_type: 'video', timestamp_seconds: 65 }));
    expect(screen.getByText(`Taken ${formatTakenDate('2024-03-12T10:00:00')}`)).toBeTruthy();
    expect(screen.getByText(/Video frame at 1:05/)).toBeTruthy();
  });

  it('keeps the name and size branch of the folder explorer', () => {
    renderLightbox({ path: '/pics/a.jpg', name: 'a.jpg', size: 1536, media_type: 'image', isBrowsing: true, taken_at: '2024-03-12T10:00:00' });
    expect(screen.getByText('a.jpg')).toBeTruthy();
    expect(screen.queryByText(/Taken/)).toBeNull();
  });
});

// jsdom has no PointerEvent; a MouseEvent with the pointer fields is enough for React's pointer handlers.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  };
}

describe('MediaLightbox navigation', () => {
  const items = [
    imageResult({ path: '/pics/a.jpg' }),
    imageResult({ path: '/pics/b.jpg' }),
    imageResult({ path: '/pics/c.jpg' }),
  ];
  const renderAt = (index, overrides = {}) => renderLightbox(items[index], { navItems: items, ...overrides });
  const touch = (type, x, y = 100, pointerId = 1) => fireEvent[type](
    screen.getByAltText('Full size result'),
    { pointerType: 'touch', pointerId, clientX: x, clientY: y }
  );

  afterEach(() => {
    cleanup();
    delete window.electronAPI;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('buttons and counter', () => {
    it('shows the position and both buttons for an item in a list of several', () => {
      renderAt(1);
      expect(screen.getByText('2 / 3')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Previous picture' }).disabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Next picture' }).disabled).toBe(false);
    });

    it('shows nothing without a list, with a list of one, or when the item is not in the list', () => {
      const { unmount } = renderLightbox(items[0]);
      expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
      expect(screen.queryByText(/ \/ /)).toBeNull();
      unmount();

      const { unmount: unmountSingle } = renderLightbox(items[0], { navItems: [items[0]] });
      expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
      unmountSingle();

      renderLightbox(imageResult({ path: '/pics/other.jpg' }), { navItems: items });
      expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
      expect(screen.queryByText(/ \/ /)).toBeNull();
    });

    it('shows nothing for an item opened from the folder window', () => {
      const browsing = { ...items[1], isBrowsing: true };
      renderLightbox(browsing, { navItems: [items[0], browsing, items[2]] });
      expect(screen.queryByRole('button', { name: 'Previous picture' })).toBeNull();
      expect(screen.queryByText(/ \/ /)).toBeNull();
      // The way out stays.
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    });

    it('moves to the neighbour with the buttons, without closing', () => {
      const { props } = renderAt(1);
      fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[2]);
      fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[0]);
      expect(props.setSelectedImage).not.toHaveBeenCalledWith(null);
    });

    it('disables previous on the first picture and next on the last, with no wrap-around', () => {
      const first = renderAt(0);
      expect(screen.getByRole('button', { name: 'Previous picture' }).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
      expect(first.props.setSelectedImage).not.toHaveBeenCalled();
      first.unmount();

      const last = renderAt(2);
      expect(screen.getByRole('button', { name: 'Next picture' }).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
      expect(last.props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('finds the picture by its key when the open item is a copy of a list item', () => {
      renderLightbox({ ...items[1] }, { navItems: items });
      expect(screen.getByText('2 / 3')).toBeTruthy();
    });

    it('preloads the next picture', () => {
      const sources = [];
      vi.stubGlobal('Image', class { set src(value) { sources.push(value); } });
      const { rerender, props } = renderAt(0);
      expect(sources).toEqual([`${API}/image?path=%2Fpics%2Fb.jpg&size=full`]);
      rerender(<MediaLightbox {...props} selectedImage={items[1]} navItems={items} />);
      expect(sources).toEqual([
        `${API}/image?path=%2Fpics%2Fb.jpg&size=full`,
        `${API}/image?path=%2Fpics%2Fc.jpg&size=full`,
      ]);
      rerender(<MediaLightbox {...props} selectedImage={items[2]} navItems={items} />);
      expect(sources).toHaveLength(2);
    });
  });

  describe('screen-sized pictures (network mode on a phone)', () => {

    afterEach(async () => {
      cleanup();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      resetBackToCloseForTests();
      setNetworkModeForTests(false);
      vi.unstubAllGlobals();
      window.history.replaceState(null, '');
    });

    it('uses size=preview for the shown picture and the preloaded next one', () => {
      window.history.replaceState(null, '');
      setNetworkModeForTests(true);
      vi.stubGlobal('screen', { width: 390, height: 844 });
      vi.stubGlobal('devicePixelRatio', 3);
      const sources = [];
      vi.stubGlobal('Image', class { set src(value) { sources.push(value); } });
      renderAt(0);
      expect(screen.getByAltText('Full size result').getAttribute('src'))
        .toBe(`${API}/image?path=%2Fpics%2Fa.jpg&size=preview`);
      expect(sources).toEqual([`${API}/image?path=%2Fpics%2Fb.jpg&size=preview`]);
    });
  });

  describe('keyboard', () => {
    it('moves with the arrow keys', () => {
      const { props } = renderAt(1);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[2]);
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[0]);
    });

    it('does nothing at the ends', () => {
      const first = renderAt(0);
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      expect(first.props.setSelectedImage).not.toHaveBeenCalled();
      first.unmount();

      const last = renderAt(2);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(last.props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('leaves the arrow keys alone when there is nothing to navigate', () => {
      const { props } = renderLightbox(items[0]);
      const onDocument = vi.fn();
      document.addEventListener('keydown', onDocument);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      document.removeEventListener('keydown', onDocument);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
      expect(onDocument).toHaveBeenCalledTimes(1);
    });

    it('closes on Esc, without letting another Esc handler fire', () => {
      const onDocument = vi.fn();
      document.addEventListener('keydown', onDocument);
      const { props } = renderAt(1);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      document.removeEventListener('keydown', onDocument);
      expect(props.setSelectedImage).toHaveBeenCalledTimes(1);
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
      expect(onDocument).not.toHaveBeenCalled();
    });

    it('closes on Esc without a list and in Electron', () => {
      window.electronAPI = { openInExplorer: vi.fn() };
      const { props } = renderLightbox(items[0]);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });

    it('prevents the default action of the keys it handles', () => {
      renderAt(1);
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([['shiftKey'], ['ctrlKey'], ['altKey'], ['metaKey']])('ignores keys pressed with %s', (modifier) => {
      const { props } = renderAt(1);
      fireEvent.keyDown(document.body, { key: 'ArrowRight', [modifier]: true });
      fireEvent.keyDown(document.body, { key: 'Escape', [modifier]: true });
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('ignores arrow keys typed in a text field, a select or an editable element', () => {
      const { props } = renderAt(1);
      const input = document.body.appendChild(document.createElement('input'));
      const textarea = document.body.appendChild(document.createElement('textarea'));
      const select = document.body.appendChild(document.createElement('select'));
      const editable = document.body.appendChild(document.createElement('div'));
      editable.setAttribute('contenteditable', 'true');
      [input, textarea, select, editable].forEach(element => {
        fireEvent.keyDown(element, { key: 'ArrowRight' });
        fireEvent.keyDown(element, { key: 'ArrowLeft' });
      });
      [input, textarea, select, editable].forEach(element => element.remove());
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('still closes on Esc pressed in a text field', () => {
      const { props } = renderAt(1);
      const input = document.body.appendChild(document.createElement('input'));
      fireEvent.keyDown(input, { key: 'Escape' });
      input.remove();
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });

    it('stops listening once closed', () => {
      const { props, rerender } = renderAt(1);
      rerender(<MediaLightbox {...props} selectedImage={null} navItems={items} />);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });
  });

  describe('swipe', () => {
    it('moves to the next picture on a swipe left and the previous one on a swipe right', () => {
      const { props } = renderAt(1);
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[2]);
      touch('pointerDown', 100);
      touch('pointerUp', 250);
      expect(props.setSelectedImage).toHaveBeenLastCalledWith(items[0]);
      expect(props.setSelectedImage).toHaveBeenCalledTimes(2);
    });

    it('does not close the view with the click that follows a swipe, but does later', () => {
      const { props, container } = renderAt(1);
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).not.toHaveBeenCalledWith(null);

      const realNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 1000);
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });

    it('ignores a short move, a mostly vertical move and a tap', () => {
      const { props } = renderAt(1);
      touch('pointerDown', 200);
      touch('pointerUp', 160);
      touch('pointerDown', 200, 100);
      touch('pointerUp', 100, 260);
      touch('pointerDown', 200);
      touch('pointerUp', 200);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('does not move past the ends, and still guards the click', () => {
      const { props, container } = renderAt(2);
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
      fireEvent.click(container.firstChild);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('cancels the gesture when a second finger touches down (pinch)', () => {
      const { props } = renderAt(1);
      touch('pointerDown', 250, 100, 1);
      touch('pointerDown', 260, 300, 2);
      touch('pointerUp', 260, 300, 2);
      touch('pointerUp', 100, 100, 1);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
      // The next single-finger swipe works again.
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).toHaveBeenCalledWith(items[2]);
    });

    it('cancels the gesture on pointercancel (the browser took it for scrolling)', () => {
      const { props } = renderAt(1);
      touch('pointerDown', 250);
      touch('pointerCancel', 100);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('ignores a swipe while the page is pinch-zoomed', () => {
      vi.stubGlobal('visualViewport', { scale: 2 });
      const { props } = renderAt(1);
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('does not treat a mouse drag as a swipe', () => {
      const { props } = renderAt(1);
      const img = screen.getByAltText('Full size result');
      fireEvent.pointerDown(img, { pointerType: 'mouse', clientX: 250, clientY: 100 });
      fireEvent.pointerUp(img, { pointerType: 'mouse', clientX: 100, clientY: 100 });
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('does not swipe an item without navigation', () => {
      const { props } = renderLightbox(items[1], { navItems: [items[1]] });
      touch('pointerDown', 250);
      touch('pointerUp', 100);
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });
  });

  describe('browser Back button (network mode)', () => {
    let pushState;

    beforeEach(() => {
      setNetworkModeForTests(true);
      window.history.replaceState(null, '');
      pushState = vi.spyOn(window.history, 'pushState');
    });

    afterEach(async () => {
      cleanup();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      resetBackToCloseForTests();
      setNetworkModeForTests(false);
      window.history.replaceState(null, '');
    });

    it('adds one history entry when opened and none when moving to another picture', async () => {
      const { rerender, props } = renderAt(0);
      await act(async () => {});
      expect(pushState).toHaveBeenCalledTimes(1);
      rerender(<MediaLightbox {...props} selectedImage={items[1]} navItems={items} />);
      rerender(<MediaLightbox {...props} selectedImage={items[2]} navItems={items} />);
      await act(async () => {});
      expect(pushState).toHaveBeenCalledTimes(1);
    });

    it('closes when the browser goes Back', async () => {
      const { props } = renderAt(1);
      await act(async () => {});
      await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
      expect(props.setSelectedImage).toHaveBeenCalledTimes(1);
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });
  });
});
