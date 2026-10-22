import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoGroupModal } from './VideoGroupModal';

const makeGroup = () => {
  const path = '/videos/clip.mp4';
  const frames = [
    { path, media_type: 'video', score: 0.87, timestamp_seconds: 5 },
    { path, media_type: 'video', score: 0.4, timestamp_seconds: 20 },
  ];
  return { path, name: 'clip.mp4', frames, bestScore: 0.87, bestFrame: frames[0] };
};

const renderModal = (overrides = {}) => {
  const props = {
    selectedVideoGroup: makeGroup(),
    setSelectedVideoGroup: vi.fn(),
    setSelectedImage: vi.fn(),
    setToast: vi.fn(),
    uiTheme: 'modern',
    ...overrides,
  };
  return { props, ...render(<VideoGroupModal {...props} />) };
};

describe('VideoGroupModal', () => {
  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  it('renders nothing without a group', () => {
    const { container } = renderModal({ selectedVideoGroup: null });
    expect(container.firstChild).toBeNull();
  });

  it('shows the name, path, frame count and best match', () => {
    renderModal();
    expect(screen.getByText('clip.mp4')).toBeTruthy();
    expect(screen.getByText('/videos/clip.mp4')).toBeTruthy();
    expect(screen.getByText('2 RETURNED FRAMES')).toBeTruthy();
    expect(screen.getByText('BEST MATCH 87%')).toBeTruthy();
    expect(screen.getByText('FRAME 1')).toBeTruthy();
    expect(screen.getByText('FRAME 2')).toBeTruthy();
  });

  it('uses the singular for one frame', () => {
    const group = makeGroup();
    group.frames = [group.frames[0]];
    renderModal({ selectedVideoGroup: group });
    expect(screen.getByText('1 RETURNED FRAME')).toBeTruthy();
  });

  it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
    renderModal({ uiTheme });
    expect(screen.getByLabelText('Close video results')).toBeTruthy();
  });

  it('closes on a backdrop click but not on a click inside the panel', () => {
    const { props, container } = renderModal();
    fireEvent.click(screen.getByText('clip.mp4'));
    expect(props.setSelectedVideoGroup).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild);
    expect(props.setSelectedVideoGroup).toHaveBeenCalledWith(null);
  });

  it('closes with the close button', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByLabelText('Close video results'));
    expect(props.setSelectedVideoGroup).toHaveBeenCalledWith(null);
  });

  it('opens a frame in the lightbox', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('FRAME 2'));
    expect(props.setSelectedImage).toHaveBeenCalledWith(props.selectedVideoGroup.frames[1]);
  });

  describe('Show in Explorer', () => {
    it('is hidden outside Electron', () => {
      renderModal();
      expect(screen.queryByText('Show in Explorer')).toBeNull();
    });

    it('opens the video and stays quiet on success', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: true }) };
      const { props } = renderModal();
      fireEvent.click(screen.getByRole('button', { name: /Show in Explorer/ }));
      await waitFor(() => expect(window.electronAPI.openInExplorer).toHaveBeenCalledWith('/videos/clip.mp4'));
      expect(props.setToast).not.toHaveBeenCalled();
    });

    it('toasts when the file was moved or deleted', async () => {
      window.electronAPI = { openInExplorer: vi.fn().mockResolvedValue({ success: false }) };
      const { props } = renderModal();
      fireEvent.click(screen.getByRole('button', { name: /Show in Explorer/ }));
      await waitFor(() => expect(props.setToast).toHaveBeenCalledWith({
        message: 'This video has been moved or deleted and is no longer available.',
        type: 'error',
      }));
    });
  });
});
