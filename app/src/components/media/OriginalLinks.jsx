import { ExternalLink, Download, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../config';
import { useSession } from '../../session/sessionContext';
import { getOriginalUrl, isHeicPath } from '../../utils/originals';

// "Open original" (an image) / "Play video" (a video) and "Download" for the file at `path`, in a browser session
// that may get originals. The desktop app has Show in Explorer instead, so nothing is rendered there.
// A picture opens in a new tab. A video plays inside the page (`onPlay`), so closing the player does not leave
// the app: without `onPlay` a video offers only Download.
// `className` is the look of one button; the host (lightbox, video modal) passes its own.
export function OriginalLinks({ path, mediaType, className, onClick, onPlay }) {
  const { t } = useTranslation('media');
  const { mode, may } = useSession();
  if (mode !== 'network' || !may('originals') || !path) return null;

  const isVideo = mediaType === 'video';
  return (
    <>
      {isVideo && onPlay && (
        <button
          type="button"
          onClick={(event) => {
            onClick?.(event);
            onPlay();
          }}
          className={className}
        >
          <Play className="w-4 h-4" aria-hidden="true" />
          {t('originals.playVideo')}
        </button>
      )}
      {!isVideo && !isHeicPath(path) && (
        <a
          href={getOriginalUrl(API_BASE, path)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={className}
        >
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          {t('originals.open')}
        </a>
      )}
      <a
        href={getOriginalUrl(API_BASE, path, { download: true })}
        download
        onClick={onClick}
        className={className}
      >
        <Download className="w-4 h-4" aria-hidden="true" />
        {t('originals.download')}
      </a>
    </>
  );
}
