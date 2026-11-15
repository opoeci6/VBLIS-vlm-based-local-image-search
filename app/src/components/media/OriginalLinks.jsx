import { ExternalLink, Download, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../config';
import { useSession } from '../../session/sessionContext';
import { getOriginalUrl, isHeicPath } from '../../utils/originals';

// "Open original" / "Play video" and "Download" for the file at `path`, in a browser session that may
// get originals. The desktop app has Show in Explorer instead, so nothing is rendered there.
// `className` is the look of one button; the host (lightbox, video modal) passes its own.
export function OriginalLinks({ path, mediaType, className, onClick }) {
  const { t } = useTranslation('media');
  const { mode, may } = useSession();
  if (mode !== 'network' || !may('originals') || !path) return null;

  const isVideo = mediaType === 'video';
  return (
    <>
      {!isHeicPath(path) && (
        <a
          href={getOriginalUrl(API_BASE, path)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={className}
        >
          {isVideo ? <Play className="w-4 h-4" aria-hidden="true" /> : <ExternalLink className="w-4 h-4" aria-hidden="true" />}
          {isVideo ? t('originals.playVideo') : t('originals.open')}
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
