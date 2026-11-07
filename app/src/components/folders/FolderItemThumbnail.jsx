import { useState, memo } from 'react';
import { Image as ImageIcon, AlertTriangle, Video } from 'lucide-react';
import { cn } from '../../utils/cn';
import { getMediaPreviewUrl } from '../../utils/media';
import { API_BASE } from '../../config';

export const FolderItemThumbnail = memo(function FolderItemThumbnail({ item, uiTheme = 'modern', onSelect }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isModern = uiTheme === 'modern';
  const isVideo = item.media_type === 'video';
  const isMissing = item.exists_on_disk === false;

  if (isMissing) {
    return (
      <div
        className={cn(
          "relative w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden select-none cursor-not-allowed",
          isModern
            ? "rounded-xl ring-1 ring-rose-500/30 bg-rose-50 dark:bg-rose-950/40 text-rose-500"
            : "border border-rose-500 bg-black text-rose-400"
        )}
        title={`${item.name} is missing from disk`}
      >
        <AlertTriangle className="w-5 h-5 text-rose-500" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer group/thumb transition-all select-none",
        isModern
          ? "rounded-xl ring-1 ring-black/5 dark:ring-white/10 hover:ring-indigo-500/50 bg-gray-100 dark:bg-neutral-800"
          : "border border-white bg-black hover:border-indigo-400"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({
          path: item.path,
          name: item.name,
          media_type: item.media_type,
          size: item.size,
          isBrowsing: true,
          timestamp_seconds: isVideo ? 1.0 : 0
        });
      }}
      title={`Click to preview ${item.name}`}
    >
      {/* Placeholder skeleton / icon while loading or if error */}
      {(!loaded || error) && (
        <div className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          isVideo
            ? "text-cyan-500 bg-cyan-500/10"
            : "text-indigo-500 bg-indigo-500/10",
          !loaded && !error && "animate-pulse"
        )}>
          {isVideo ? <Video className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
        </div>
      )}

      {!error && (
        <img
          src={getMediaPreviewUrl(API_BASE, item, 'thumbnail')}
          alt={item.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "w-full h-full object-cover transition-all duration-300 group-hover/thumb:scale-110",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}

      {/* Video indicator badge */}
      {isVideo && (
        <div className="absolute bottom-0.5 right-0.5 px-1 py-0.2 bg-black/80 backdrop-blur-sm rounded text-[8px] font-bold text-cyan-300 flex items-center gap-0.5 pointer-events-none">
          <Video className="w-2.5 h-2.5" />
        </div>
      )}
    </div>
  );
});
