import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoGroupModal } from './VideoGroupModal';
import { formatTakenDate } from '../../utils/formatters';

const makeGroup = () => {
  const path = '/videos/clip.mp4';
  const frames = [
    { path, media_type: 'video', score: 0.87, timestamp_seconds: 5 },
    { path, media_type: 'video', score: 0.4, timestamp_seconds: 20 },
  ];
  return { path, name: 'clip.mp4', frames, bestScore: 0.87, bestFrame: frames[0] };
};

const makeBigGroup = (count, path = '/videos/big.mp4') => {
  const frames = Array.from({ length: count }, (_, i) => (
    { path, media_type: 'video', score: 0.9 - i * 0.001, timestamp_seconds: i, id: `${path}:${i}` }
  ));
  return { path, name: 'big.mp4', frames, bestScore: 0.9, bestFrame: frames[0], totalFrames: null, isExpanded: false };
};

const renderModal = (overrides = {}) => {
  const props = {
    selectedVideoGroup: makeGroup(),
    setSelectedVideoGroup: vi.fn(),
    setSelectedImage: vi.fn(),
    setToast: vi.fn(),
    uiTheme: 'modern',
    onFindMoreFrames: vi.fn(),
    isFindingMoreFrames: false,
    canFindMoreFrames: true,
    ...overrides,
  };
  return { props, ...render(<VideoGroupModal {...props} />) };
};

const renderedFrames = () => screen.queryAllByText(/^FRAME \d+$/);

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

  it('says BEST SIMILARITY when the best frame is a similarity result', () => {
    const group = makeGroup();
    group.frames = group.frames.map(f => ({ ...f, score_kind: 'similarity' }));
    group.bestFrame = group.frames[0];
    renderModal({ selectedVideoGroup: group });
    expect(screen.getByText('BEST SIMILARITY 87%')).toBeTruthy();
    expect(screen.getAllByText(/SIMILAR$/)).toHaveLength(2);
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

  it('stays open when a drag from inside the panel ends on the backdrop', () => {
    const { props, container } = renderModal();
    fireEvent.mouseDown(screen.getByText('clip.mp4'));
    fireEvent.click(container.firstChild);
    expect(props.setSelectedVideoGroup).not.toHaveBeenCalled();
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

  describe('Find more frames', () => {
    it('is shown without Electron and calls onFindMoreFrames with the video path', () => {
      const { props } = renderModal();
      expect(window.electronAPI).toBeUndefined();
      fireEvent.click(screen.getByRole('button', { name: /Find more frames/ }));
      expect(props.onFindMoreFrames).toHaveBeenCalledTimes(1);
      expect(props.onFindMoreFrames).toHaveBeenCalledWith('/videos/clip.mp4');
    });

    it('sits next to Show in Explorer in Electron', () => {
      window.electronAPI = { openInExplorer: vi.fn() };
      renderModal();
      expect(screen.getByRole('button', { name: /Find more frames/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Show in Explorer/ })).toBeTruthy();
    });

    it('is disabled with a spinner while loading', () => {
      const { props } = renderModal({ isFindingMoreFrames: true });
      const button = screen.getByRole('button', { name: /Finding frames/ });
      expect(button.textContent).toBe('Finding frames…');
      expect(button.disabled).toBe(true);
      expect(button.querySelector('.animate-spin')).toBeTruthy();
      expect(screen.queryByText('Find more frames')).toBeNull();
      fireEvent.click(button);
      expect(props.onFindMoreFrames).not.toHaveBeenCalled();
    });

    it('is enabled without a spinner when idle', () => {
      renderModal();
      const button = screen.getByRole('button', { name: /Find more frames/ });
      expect(button.disabled).toBe(false);
      expect(button.querySelector('.animate-spin')).toBeNull();
    });

    it('is hidden once the group is expanded', () => {
      renderModal({ selectedVideoGroup: { ...makeGroup(), isExpanded: true, totalFrames: 40 } });
      expect(screen.queryByRole('button', { name: /Find more frames|Finding frames/ })).toBeNull();
    });

    it('is hidden when finding more frames is not possible', () => {
      renderModal({ canFindMoreFrames: false });
      expect(screen.queryByRole('button', { name: /Find more frames|Finding frames/ })).toBeNull();
    });

    it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
      renderModal({ uiTheme });
      expect(screen.getByRole('button', { name: /Find more frames/ })).toBeTruthy();
    });

    it('shows the matching-of-total badge once expanded', () => {
      renderModal({ selectedVideoGroup: { ...makeGroup(), isExpanded: true, totalFrames: 765 } });
      expect(screen.getByText('2 MATCHING OF 765')).toBeTruthy();
      expect(screen.queryByText(/RETURNED FRAME/)).toBeNull();
    });
  });

  describe('progressive rendering', () => {
    let observers;

    beforeEach(() => {
      observers = [];
      vi.stubGlobal('IntersectionObserver', class {
        constructor(callback) {
          this.callback = callback;
          this.observed = [];
          observers.push(this);
        }
        observe(node) { this.observed.push(node); }
        disconnect() {}
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const scrollToBottom = () => {
      const observer = observers[observers.length - 1];
      act(() => observer.callback([{ isIntersecting: true }]));
    };

    it('renders only the first 60 frames of a large group', () => {
      renderModal({ selectedVideoGroup: makeBigGroup(200) });
      expect(renderedFrames()).toHaveLength(60);
      expect(screen.getByText('FRAME 60')).toBeTruthy();
      expect(screen.queryByText('FRAME 61')).toBeNull();
      expect(screen.getByText('200 RETURNED FRAMES')).toBeTruthy();
    });

    it('renders everything for a small group and needs no sentinel', () => {
      renderModal({ selectedVideoGroup: makeBigGroup(60) });
      expect(renderedFrames()).toHaveLength(60);
      expect(observers).toHaveLength(0);
    });

    it('adds 80 frames when the sentinel scrolls into view', () => {
      renderModal({ selectedVideoGroup: makeBigGroup(200) });
      expect(observers.length).toBeGreaterThan(0);
      expect(observers[observers.length - 1].observed.length).toBe(1);

      scrollToBottom();
      expect(renderedFrames()).toHaveLength(140);
      scrollToBottom();
      expect(renderedFrames()).toHaveLength(200);
    });

    it('resets to 60 frames when another video is opened', () => {
      const first = makeBigGroup(200, '/videos/one.mp4');
      const { props, rerender } = renderModal({ selectedVideoGroup: first });
      scrollToBottom();
      expect(renderedFrames()).toHaveLength(140);

      rerender(<VideoGroupModal {...props} selectedVideoGroup={makeBigGroup(200, '/videos/two.mp4')} />);
      expect(renderedFrames()).toHaveLength(60);
    });

    it('keeps the scroll position when the same video gains frames', () => {
      const { props, rerender } = renderModal({ selectedVideoGroup: makeBigGroup(100) });
      scrollToBottom();
      expect(renderedFrames()).toHaveLength(100);

      const expanded = { ...makeBigGroup(300), isExpanded: true, totalFrames: 300 };
      rerender(<VideoGroupModal {...props} selectedVideoGroup={expanded} />);
      expect(renderedFrames()).toHaveLength(100);
      expect(screen.getByText('300 MATCHING OF 300')).toBeTruthy();
    });
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

describe('VideoGroupModal without scores (library view)', () => {
  afterEach(cleanup);

  const libraryGroup = () => {
    const path = '/videos/clip.mp4';
    const frames = [5, 20].map(timestamp_seconds => (
      { path, media_type: 'video', score: null, score_kind: 'none', taken_at: '2024-03-12T10:00:00', timestamp_seconds }
    ));
    return { path, name: 'clip.mp4', frames, bestScore: 0, bestFrame: frames[0], isExpanded: false, totalFrames: null };
  };

  it('hides the best match and shows no percentages, without a Find more frames button', () => {
    renderModal({ selectedVideoGroup: libraryGroup(), canFindMoreFrames: false });
    expect(screen.getByText('clip.mp4')).toBeTruthy();
    expect(screen.queryByText(/BEST/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Find more frames/ })).toBeNull();
    expect(renderedFrames()).toHaveLength(2);
  });

  it.each(['modern', 'terminal'])('renders the frames in the %s theme', (uiTheme) => {
    renderModal({ selectedVideoGroup: libraryGroup(), canFindMoreFrames: false, uiTheme });
    expect(screen.queryByText(/BEST/)).toBeNull();
    expect(screen.getAllByText(formatTakenDate('2024-03-12T10:00:00'))).toHaveLength(2);
  });
});
