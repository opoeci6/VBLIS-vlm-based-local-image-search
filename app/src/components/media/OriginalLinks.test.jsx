import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OriginalLinks } from './OriginalLinks';
import { MediaLightbox } from './MediaLightbox';
import { VideoGroupModal } from '../search/VideoGroupModal';
import { SessionProvider } from '../../session/SessionProvider';
import { getMediaPreviewUrl } from '../../utils/media';
import { getOriginalUrl, isHeicPath } from '../../utils/originals';

const info = (role, originals) => ({
  signed_in: true,
  role,
  account: { id: 'a1', name: 'alice' },
  permissions: { originals, image_search: true, places: true },
  secure: true,
  case_sensitive_paths: true,
});

const inSession = (session, ui) => render(<SessionProvider info={session} onSignOut={vi.fn()}>{ui}</SessionProvider>);

const lightbox = (item, props = {}) => (
  <MediaLightbox selectedImage={item} setSelectedImage={vi.fn()} setToast={vi.fn()} uiTheme="modern" {...props} />
);

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

const ORIGINAL_V = 'http://127.0.0.1:8000/media/original?path=%2Fv%2Fc.mp4';
const CANNOT_PLAY = "This browser can't play this video. Download it to watch it.";

describe('original links', () => {
  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  describe('URLs', () => {
    it('builds the original URL, with and without the download flag', () => {
      expect(getOriginalUrl('/api', '/p/a b.jpg')).toBe('/api/media/original?path=%2Fp%2Fa+b.jpg');
      expect(getOriginalUrl('/api', '/p/a.jpg', { download: true })).toBe('/api/media/original?path=%2Fp%2Fa.jpg&download=1');
    });

    it('recognises HEIC and HEIF files in any case', () => {
      expect(isHeicPath('/p/IMG_1.HEIC')).toBe(true);
      expect(isHeicPath('/p/a.heif')).toBe(true);
      expect(isHeicPath('/p/a.jpg')).toBe(false);
      expect(isHeicPath('/p/heic.jpg')).toBe(false);
      expect(isHeicPath(undefined)).toBe(false);
    });
  });

  describe('OriginalLinks', () => {
    const links = (props = {}) => <OriginalLinks path="/p/a.jpg" mediaType="image" className="x" {...props} />;

    it('gives the owner an Open original link and a Download link', () => {
      inSession(info('owner', true), links());
      const open = screen.getByRole('link', { name: 'Open original' });
      expect(open.getAttribute('href')).toBe('http://127.0.0.1:8000/media/original?path=%2Fp%2Fa.jpg');
      expect(open.getAttribute('target')).toBe('_blank');
      expect(open.getAttribute('rel')).toBe('noopener noreferrer');
      const download = screen.getByRole('link', { name: 'Download' });
      expect(download.getAttribute('href')).toBe('http://127.0.0.1:8000/media/original?path=%2Fp%2Fa.jpg&download=1');
      expect(download.hasAttribute('download')).toBe(true);
    });

    it('offers Play video as a button, not a link, for a video when it can play it', () => {
      const onPlay = vi.fn();
      const onClick = vi.fn();
      inSession(info('owner', true), links({ path: '/v/clip.mp4', mediaType: 'video', onPlay, onClick }));
      const play = screen.getByRole('button', { name: 'Play video' });
      expect(play.getAttribute('type')).toBe('button');
      expect(play.getAttribute('class')).toBe('x');
      expect(screen.queryByRole('link', { name: 'Play video' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
      fireEvent.click(play);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onPlay).toHaveBeenCalledTimes(1);
    });

    it('offers only Download for a video without onPlay, and no new-tab link', () => {
      const { container } = inSession(info('owner', true), links({ path: '/v/clip.mp4', mediaType: 'video' }));
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Play video' })).toBeNull();
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
      expect(container.querySelector('a[target="_blank"]')).toBeNull();
    });

    it('keeps the new-tab link for an image even when onPlay is given', () => {
      inSession(info('owner', true), links({ onPlay: vi.fn() }));
      expect(screen.getByRole('link', { name: 'Open original' }).getAttribute('target')).toBe('_blank');
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    });

    it('offers only Download for a HEIC original', () => {
      inSession(info('owner', true), links({ path: '/p/IMG_1.HEIC' }));
      expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    });

    it('is offered to a viewer with the originals permission', () => {
      inSession(info('viewer', true), links());
      expect(screen.getByRole('link', { name: 'Open original' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    });

    it('is not offered to a viewer without the permission', () => {
      inSession(info('viewer', false), links());
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('is not offered on the desktop', () => {
      render(links());
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('in the lightbox', () => {
    it('shows the links for an image and for a video frame', () => {
      const { unmount } = inSession(info('owner', true), lightbox({ path: '/p/a.jpg', media_type: 'image', score: 0.5 }));
      expect(screen.getByRole('link', { name: 'Open original' })).toBeTruthy();
      unmount();

      inSession(info('owner', true), lightbox({ path: '/v/c.mp4', media_type: 'video', timestamp_seconds: 3, score: 0.5 }));
      expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Play video' })).toBeNull();
    });

    it('does not close the lightbox when a link is clicked', () => {
      const setSelectedImage = vi.fn();
      inSession(info('owner', true), (
        <MediaLightbox selectedImage={{ path: '/p/a.jpg', media_type: 'image', score: 0.5 }} setSelectedImage={setSelectedImage} setToast={vi.fn()} uiTheme="modern" />
      ));
      const link = screen.getByRole('link', { name: 'Download' });
      // jsdom cannot navigate; this only keeps it quiet.
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
      expect(setSelectedImage).not.toHaveBeenCalled();
    });

    it('hides the links from a viewer without the permission', () => {
      inSession(info('viewer', false), lightbox({ path: '/p/a.jpg', media_type: 'image', score: 0.5 }));
      expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
    });

    it('keeps Show in Explorer and shows no links on the desktop', () => {
      window.electronAPI = { openInExplorer: vi.fn() };
      render(lightbox({ path: '/p/a.jpg', media_type: 'image', score: 0.5 }));
      expect(screen.getByRole('button', { name: /Show in Explorer/ })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
    });
  });

  describe('playing a video in the lightbox', () => {
    const videoItem = (extra = {}) => ({ path: '/v/c.mp4', media_type: 'video', timestamp_seconds: 3, score: 0.5, ...extra });
    const play = () => fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    const asOwner = (ui) => <SessionProvider info={info('owner', true)} onSignOut={vi.fn()}>{ui}</SessionProvider>;
    // jsdom does not implement media playback.
    let playSpy;
    beforeEach(() => {
      playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    });
    afterEach(() => vi.restoreAllMocks());

    it('replaces the picture with the player at the frame time, without leaving the view', () => {
      const setSelectedImage = vi.fn();
      const { container } = inSession(info('owner', true), lightbox(videoItem(), { setSelectedImage }));
      expect(container.querySelector('video')).toBeNull();
      play();
      const video = container.querySelector('video');
      // Started within the tap (iOS plays with sound only then), on the player itself.
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(playSpy.mock.contexts[0]).toBe(video);
      expect(video.getAttribute('src')).toBe(`${ORIGINAL_V}#t=3`);
      expect(video.hasAttribute('controls')).toBe(true);
      expect(video.hasAttribute('playsinline')).toBe(true);
      expect(video.getAttribute('poster')).toBe(getMediaPreviewUrl('http://127.0.0.1:8000', videoItem(), 'full'));
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(container.querySelector('a[target="_blank"]')).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
      expect(setSelectedImage).not.toHaveBeenCalled();
      // A click on the player does not reach the backdrop.
      fireEvent.click(video);
      expect(setSelectedImage).not.toHaveBeenCalled();
    });

    it('stops blurring the page behind while the video plays, and blurs it again when it cannot play', () => {
      const { container } = inSession(info('owner', true), lightbox(videoItem()));
      const overlay = container.querySelector('.app-overlay');
      expect(overlay.classList.contains('backdrop-blur-md')).toBe(true);
      play();
      expect(overlay.classList.contains('backdrop-blur-md')).toBe(false);
      fireEvent.error(container.querySelector('video'));
      expect(overlay.classList.contains('backdrop-blur-md')).toBe(true);
    });

    it('has no fragment for a frame at 0 or without a time, and trims the decimals', () => {
      const srcFor = (extra) => {
        const { container, unmount } = inSession(info('owner', true), lightbox(videoItem(extra)));
        play();
        const src = container.querySelector('video').getAttribute('src');
        unmount();
        return src;
      };
      expect(srcFor({ timestamp_seconds: 0 })).toBe(ORIGINAL_V);
      expect(srcFor({ timestamp_seconds: undefined })).toBe(ORIGINAL_V);
      expect(srcFor({ timestamp_seconds: 12.5 })).toBe(`${ORIGINAL_V}#t=12.5`);
      expect(srcFor({ timestamp_seconds: 1.23456 })).toBe(`${ORIGINAL_V}#t=1.235`);
    });

    it('keeps the player when the browser refuses to start it, so its own controls can', async () => {
      playSpy.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
      const { container } = inSession(info('owner', true), lightbox(videoItem()));
      play();
      await Promise.resolve();
      expect(container.querySelector('video')).not.toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('brings the picture back with a message when the browser cannot play it', () => {
      const { container } = inSession(info('owner', true), lightbox(videoItem()));
      play();
      fireEvent.error(container.querySelector('video'));
      expect(container.querySelector('video')).toBeNull();
      expect(screen.getByRole('img')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(CANNOT_PLAY);
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    });

    it('goes back to the picture when another item is shown', () => {
      const { container, rerender } = inSession(info('owner', true), lightbox(videoItem()));
      play();
      expect(container.querySelector('video')).not.toBeNull();
      rerender(asOwner(lightbox(videoItem({ path: '/v/d.mp4' }))));
      expect(container.querySelector('video')).toBeNull();
      expect(screen.getByRole('img')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
    });

    it('forgets a failure when another item is shown', () => {
      const { container, rerender } = inSession(info('owner', true), lightbox(videoItem()));
      play();
      fireEvent.error(container.querySelector('video'));
      rerender(asOwner(lightbox(videoItem({ path: '/v/d.mp4' }))));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
    });

    it('offers no Play video for an image', () => {
      inSession(info('owner', true), lightbox({ path: '/p/a.jpg', media_type: 'image', score: 0.5 }));
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    });

    it('offers no player to a viewer without the permission, nor on the desktop', () => {
      const first = inSession(info('viewer', false), lightbox(videoItem()));
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      first.unmount();
      window.electronAPI = { openInExplorer: vi.fn() };
      const { container } = render(lightbox(videoItem()));
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(container.querySelector('video')).toBeNull();
    });

    describe('with a list to walk', () => {
      const items = [videoItem({ path: '/v/a.mp4' }), videoItem(), videoItem({ path: '/v/e.mp4' })];
      const open = () => {
        const setSelectedImage = vi.fn();
        const view = inSession(info('owner', true), lightbox(items[1], { setSelectedImage, navItems: items }));
        play();
        return { setSelectedImage, video: view.container.querySelector('video') };
      };
      const touch = (type, element, x) => fireEvent[type](element, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 100 });

      it('does not treat a touch swipe that starts on the video as a swipe', () => {
        const { setSelectedImage, video } = open();
        touch('pointerDown', video, 250);
        touch('pointerUp', video, 100);
        expect(setSelectedImage).not.toHaveBeenCalled();
      });

      it('still swipes from the rest of the view', () => {
        const { setSelectedImage, video } = open();
        const backdrop = video.parentElement;
        touch('pointerDown', backdrop, 250);
        touch('pointerUp', backdrop, 100);
        expect(setSelectedImage).toHaveBeenLastCalledWith(items[2]);
      });

      it('leaves the arrow keys to the player while it has the focus', () => {
        const { setSelectedImage, video } = open();
        fireEvent.keyDown(video, { key: 'ArrowRight' });
        fireEvent.keyDown(video, { key: 'ArrowLeft' });
        expect(setSelectedImage).not.toHaveBeenCalled();
        // Elsewhere they still move.
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(setSelectedImage).toHaveBeenLastCalledWith(items[2]);
      });
    });
  });

  describe('in the video modal', () => {
    const group = () => {
      const path = '/videos/clip.mp4';
      const frames = [{ path, media_type: 'video', score: 0.87, timestamp_seconds: 5 }];
      return { path, name: 'clip.mp4', frames, bestScore: 0.87, bestFrame: frames[0] };
    };
    const modal = () => (
      <VideoGroupModal selectedVideoGroup={group()} setSelectedVideoGroup={vi.fn()} setSelectedImage={vi.fn()} setToast={vi.fn()} uiTheme="modern" />
    );

    it('offers Play video and Download for the video', () => {
      inSession(info('viewer', true), modal());
      expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Play video' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toContain('download=1');
    });

    it('offers nothing to a viewer without the permission, nor on the desktop', () => {
      const first = inSession(info('viewer', false), modal());
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(first.container.querySelector('video')).toBeNull();
      first.unmount();
      window.electronAPI = { openInExplorer: vi.fn() };
      const { container } = render(modal());
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      expect(container.querySelector('video')).toBeNull();
      expect(screen.getByRole('button', { name: /Show in Explorer/ })).toBeTruthy();
    });

    describe('playing the video', () => {
      let playSpy;
      beforeEach(() => {
        playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
      });
      afterEach(() => vi.restoreAllMocks());
      const play = () => fireEvent.click(screen.getByRole('button', { name: 'Play video' }));

      it('shows the player above the frames, from the start', () => {
        const { container } = inSession(info('viewer', true), modal());
        expect(container.querySelector('video')).toBeNull();
        play();
        const video = container.querySelector('video');
        expect(playSpy).toHaveBeenCalledTimes(1);
        expect(playSpy.mock.contexts[0]).toBe(video);
        expect(video.getAttribute('src')).toBe('http://127.0.0.1:8000/media/original?path=%2Fvideos%2Fclip.mp4');
        expect(video.hasAttribute('poster')).toBe(false);
        expect(video.hasAttribute('controls')).toBe(true);
        expect(video.hasAttribute('playsinline')).toBe(true);
        expect(video.className).toContain('rounded-2xl');
        const frame = within(container).getByRole('button', { name: /Frame 1/i });
        expect(video.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
      });

      it('stops blurring the page behind while the video plays', () => {
        const { container } = inSession(info('viewer', true), modal());
        const overlay = container.querySelector('.app-overlay');
        expect(overlay.classList.contains('backdrop-blur-md')).toBe(true);
        play();
        expect(overlay.classList.contains('backdrop-blur-md')).toBe(false);
        fireEvent.error(container.querySelector('video'));
        expect(overlay.classList.contains('backdrop-blur-md')).toBe(true);
      });

      it('shows a message and no Play video when the browser cannot play it', () => {
        const { container } = inSession(info('viewer', true), modal());
        play();
        fireEvent.error(container.querySelector('video'));
        expect(container.querySelector('video')).toBeNull();
        expect(screen.getByRole('status').textContent).toBe(CANNOT_PLAY);
        expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
      });

      it('pauses the player, and keeps it, when a frame is opened', () => {
        const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        const setSelectedImage = vi.fn();
        const { container } = inSession(info('viewer', true), (
          <VideoGroupModal selectedVideoGroup={group()} setSelectedVideoGroup={vi.fn()} setSelectedImage={setSelectedImage} setToast={vi.fn()} uiTheme="modern" />
        ));
        play();
        const video = container.querySelector('video');
        fireEvent.click(screen.getByRole('button', { name: /Frame 1/i }));
        expect(pause).toHaveBeenCalledTimes(1);
        expect(pause.mock.contexts[0]).toBe(video);
        expect(setSelectedImage).toHaveBeenCalledTimes(1);
        expect(container.querySelector('video')).toBe(video);
      });

      it('opens a frame without a player running', () => {
        const setSelectedImage = vi.fn();
        inSession(info('viewer', true), (
          <VideoGroupModal selectedVideoGroup={group()} setSelectedVideoGroup={vi.fn()} setSelectedImage={setSelectedImage} setToast={vi.fn()} uiTheme="modern" />
        ));
        fireEvent.click(screen.getByRole('button', { name: /Frame 1/i }));
        expect(setSelectedImage).toHaveBeenCalledTimes(1);
      });

      it('goes back to Play video when another video is shown', () => {
        const other = { ...group(), path: '/videos/other.mp4', name: 'other.mp4' };
        const { container, rerender } = inSession(info('viewer', true), modal());
        play();
        expect(container.querySelector('video')).not.toBeNull();
        rerender(
          <SessionProvider info={info('viewer', true)} onSignOut={vi.fn()}>
            <VideoGroupModal selectedVideoGroup={other} setSelectedVideoGroup={vi.fn()} setSelectedImage={vi.fn()} setToast={vi.fn()} uiTheme="modern" />
          </SessionProvider>
        );
        expect(container.querySelector('video')).toBeNull();
        expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();
      });
    });
  });
});
