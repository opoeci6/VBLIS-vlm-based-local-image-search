import { useState, memo } from 'react';
import { Video } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatVideoTimestamp } from '../../utils/formatters';
import { getMediaPreviewUrl } from '../../utils/media';
import { API_BASE } from '../../config';

export const VideoFrameCard = memo(function VideoFrameCard({ frame, index, onSelect, uiTheme = 'modern' }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isModern = uiTheme === 'modern';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group cursor-pointer overflow-hidden focus:outline-none transition-all duration-200",
        isModern
          ? "rounded-2xl border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800/40 hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-500/40"
          : "border border-white bg-black focus:ring-2 focus:ring-white"
      )}
      onClick={() => onSelect(frame)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(frame);
        }
      }}
    >
      <div className={cn(
        "relative h-44 overflow-hidden bg-neutral-200 dark:bg-neutral-800",
        isModern ? "border-b border-gray-100 dark:border-neutral-700/50" : "border-b border-white"
      )}>
        {/* Placeholder skeleton while loading */}
        {(!loaded || error) && (
          <div className={cn(
            "absolute inset-0 flex flex-col items-center justify-center text-cyan-500 bg-cyan-500/10 transition-opacity",
            !loaded && !error && "animate-pulse"
          )}>
            <Video className="w-7 h-7 opacity-70 mb-1" />
            <span className="text-[10px] font-mono text-cyan-400 font-bold">
              {formatVideoTimestamp(frame.timestamp_seconds)}
            </span>
          </div>
        )}

        {!error && (
          <img
            src={getMediaPreviewUrl(API_BASE, frame, 'thumbnail')}
            alt={`Video frame at ${formatVideoTimestamp(frame.timestamp_seconds)}`}
            className={cn(
              "h-full w-full object-cover transition-all duration-500 group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0"
            )}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}

        <span className={cn(
          "absolute bottom-2 left-2 px-2.5 py-1 text-xs font-bold shadow-lg",
          isModern
            ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10"
            : "border border-white bg-black text-white"
        )}>
          {formatVideoTimestamp(frame.timestamp_seconds)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 text-xs font-bold text-neutral-700 dark:text-neutral-200">
        <span>FRAME {index + 1}</span>
        <span className="text-emerald-500 font-semibold">{Math.round((frame.score || 0) * 100)}% MATCH</span>
      </div>
    </div>
  );
});
