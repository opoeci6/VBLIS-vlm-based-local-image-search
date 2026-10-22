import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaLightbox } from './MediaLightbox';

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

    it('lists the other paths', () => {
      renderLightbox(duplicate());
      expect(screen.getByText('Also found at:')).toBeTruthy();
      expect(screen.getByTitle('Show /x/a.jpg in Explorer')).toBeTruthy();
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

  describe('closing', () => {
    it('closes on a backdrop click', () => {
      const { props, container } = renderLightbox(imageResult());
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
      fireEvent.click(screen.getByRole('button'));
      expect(props.setSelectedImage).toHaveBeenCalledWith(null);
    });
  });
});
