import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OriginalLinks } from './OriginalLinks';
import { MediaLightbox } from './MediaLightbox';
import { VideoGroupModal } from '../search/VideoGroupModal';
import { SessionProvider } from '../../session/SessionProvider';
import { getOriginalUrl, isHeicPath } from '../../utils/originals';

const info = (role, originals) => ({
  signed_in: true,
  role,
  permissions: { originals, image_search: true },
  secure: true,
  case_sensitive_paths: true,
  viewer_enabled: true,
});

const inSession = (session, ui) => render(<SessionProvider info={session} onSignOut={vi.fn()}>{ui}</SessionProvider>);

const lightbox = (item) => (
  <MediaLightbox selectedImage={item} setSelectedImage={vi.fn()} setToast={vi.fn()} uiTheme="modern" />
);

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

    it('says Play video for a video', () => {
      inSession(info('owner', true), links({ path: '/v/clip.mp4', mediaType: 'video' }));
      expect(screen.getByRole('link', { name: 'Play video' }).getAttribute('href')).toContain('path=%2Fv%2Fclip.mp4');
      expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
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
      expect(screen.getByRole('link', { name: 'Play video' }).getAttribute('href')).toContain('path=%2Fv%2Fc.mp4');
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
      expect(screen.getByRole('link', { name: 'Play video' }).getAttribute('href')).toContain('path=%2Fvideos%2Fclip.mp4');
      expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toContain('download=1');
    });

    it('offers nothing to a viewer without the permission, nor on the desktop', () => {
      const first = inSession(info('viewer', false), modal());
      expect(screen.queryByRole('link')).toBeNull();
      first.unmount();
      window.electronAPI = { openInExplorer: vi.fn() };
      render(modal());
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByRole('button', { name: /Show in Explorer/ })).toBeTruthy();
    });
  });
});
