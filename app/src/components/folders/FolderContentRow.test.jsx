import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderContentRow } from './FolderContentRow';

const makeItem = (extra = {}) => ({
  path: '/p/a.jpg',
  name: 'a.jpg',
  relative_path: 'sub/a.jpg',
  media_type: 'image',
  size: 2048,
  is_indexed: true,
  exists_on_disk: true,
  ...extra,
});

const renderRow = (item, overrides = {}) => {
  const props = { item, uiTheme: 'modern', setSelectedImage: vi.fn(), setToast: vi.fn(), ...overrides };
  return { props, ...render(<FolderContentRow {...props} />) };
};

describe('FolderContentRow', () => {
  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  it('shows the name, relative path, status, type and size', () => {
    renderRow(makeItem());
    expect(screen.getByText('a.jpg')).toBeTruthy();
    expect(screen.getByText('sub/a.jpg')).toBeTruthy();
    expect(screen.getByText('Indexed')).toBeTruthy();
    expect(screen.getByText('image')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
  });

  it('shows "Not Indexed" for unindexed items and hides a zero size', () => {
    renderRow(makeItem({ is_indexed: false, size: 0, media_type: 'video' }));
    expect(screen.getByText('Not Indexed')).toBeTruthy();
    expect(screen.getByText('video')).toBeTruthy();
    expect(screen.queryByText(/KB|B$/)).toBeNull();
  });

  it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
    renderRow(makeItem(), { uiTheme });
    expect(screen.getByText('a.jpg')).toBeTruthy();
  });

  it('opens an image preview with timestamp 0 and isBrowsing', () => {
    const { props } = renderRow(makeItem());
    fireEvent.click(screen.getByText('a.jpg'));
    expect(props.setSelectedImage).toHaveBeenCalledWith({
      path: '/p/a.jpg', name: 'a.jpg', media_type: 'image', size: 2048, isBrowsing: true, timestamp_seconds: 0,
    });
  });

  it('opens a video preview with timestamp 1', () => {
    const { props } = renderRow(makeItem({ path: '/p/v.mp4', name: 'v.mp4', media_type: 'video' }));
    fireEvent.click(screen.getByText('v.mp4'));
    expect(props.setSelectedImage).toHaveBeenCalledWith(expect.objectContaining({
      isBrowsing: true, timestamp_seconds: 1.0, media_type: 'video',
    }));
  });

  describe('missing items', () => {
    const missing = () => makeItem({ exists_on_disk: false });

    it('shows the missing badge and does not open a preview', () => {
      const { props } = renderRow(missing());
      expect(screen.getByText('Missing on Disk')).toBeTruthy();
      expect(screen.queryByText('Indexed')).toBeNull();
      expect(screen.queryByText('2 KB')).toBeNull();

      fireEvent.click(screen.getByText('a.jpg'));
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('disables Show in Explorer', () => {
      renderRow(missing());
      const button = screen.getByTitle('File is missing on disk');
      expect(button.disabled).toBe(true);
    });
  });

  describe('Show in Explorer', () => {
    it('does nothing outside Electron', () => {
      const { props } = renderRow(makeItem());
      fireEvent.click(screen.getByTitle('Show in Explorer'));
      expect(props.setToast).not.toHaveBeenCalled();
      expect(props.setSelectedImage).not.toHaveBeenCalled();
    });

    it('opens the file without selecting the row', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: true }) };
      const { props } = renderRow(makeItem());
      fireEvent.click(screen.getByTitle('Show in Explorer'));
      await waitFor(() => expect(window.electronAPI.openInExplorer).toHaveBeenCalledWith('/p/a.jpg'));
      expect(props.setSelectedImage).not.toHaveBeenCalled();
      expect(props.setToast).not.toHaveBeenCalled();
    });

    it('toasts the Electron error on failure', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false, error: 'denied' }) };
      const { props } = renderRow(makeItem());
      fireEvent.click(screen.getByTitle('Show in Explorer'));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({ type: 'error', message: 'denied' }));
    });

    it('uses a default message when no error text is given', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue(undefined) };
      const { props } = renderRow(makeItem());
      fireEvent.click(screen.getByTitle('Show in Explorer'));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({
        type: 'error', message: 'Failed to open file in explorer.',
      }));
    });
  });
});
