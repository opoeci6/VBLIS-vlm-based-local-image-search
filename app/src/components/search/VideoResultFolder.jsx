import { memo } from 'react';
import { FolderOpen, ChevronRight, Video } from 'lucide-react';
import { cn } from '../../utils/cn';
import { getMediaPreviewUrl, prewarmVideoGroup } from '../../utils/media';

export const VideoResultFolder = memo(function VideoResultFolder({ group, idx, API_BASE, onSelect, uiTheme = 'modern' }) {
  const isModern = uiTheme === 'modern';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group cursor-pointer overflow-hidden animate-in fade-in zoom-in-95 fill-mode-both focus:outline-none transition-all duration-300",
        isModern
          ? "rounded-3xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 bg-white dark:bg-neutral-900 hover:shadow-2xl hover:-translate-y-1"
          : "border border-white bg-black focus:ring-2 focus:ring-white"
      )}
      style={{
        animationDelay: `${idx * 50}ms`,
        animationDuration: '400ms'
      }}
      onMouseEnter={() => prewarmVideoGroup(API_BASE, group)}
      onClick={() => {
        prewarmVideoGroup(API_BASE, group);
        onSelect(group);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          prewarmVideoGroup(API_BASE, group);
          onSelect(group);
        }
      }}
    >
      <div className={cn(
        "relative h-48 overflow-hidden bg-neutral-100 dark:bg-neutral-800",
        !isModern && "border-b border-white"
      )}>
        <img
          src={getMediaPreviewUrl(API_BASE, group.bestFrame)}
          alt={`Best matching frame from ${group.name}`}
          className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          loading="lazy"
        />
        <div className={cn(
          "absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 text-xs font-bold shadow-lg",
          isModern ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10" : "bg-black border border-white text-white"
        )}>
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          VIDEO
        </div>
        <div className={cn(
          "absolute bottom-3 right-3 px-3 py-1 text-xs font-bold shadow-lg",
          isModern ? "bg-black/70 backdrop-blur-md text-emerald-400 rounded-full ring-1 ring-white/10" : "bg-black border border-white text-emerald-400"
        )}>
          BEST {Math.round(group.bestScore * 100)}%
        </div>
      </div>

      <div className={cn(
        "p-4 flex items-center gap-3",
        isModern ? "bg-white dark:bg-neutral-900 border-t border-gray-100 dark:border-white/5" : "bg-black"
      )}>
        <div className={cn(
          "flex h-11 w-11 flex-shrink-0 items-center justify-center",
          isModern ? "rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "icon-tile border border-white text-white"
        )}>
          <Video className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("font-bold truncate text-sm", isModern ? "text-neutral-800 dark:text-neutral-100" : "text-white")} title={group.path}>
            {group.name}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            {group.frames.length} returned frame{group.frames.length === 1 ? '' : 's'}
          </p>
        </div>
        <ChevronRight className={cn(
          "w-5 h-5 flex-shrink-0 transition-transform group-hover:translate-x-1",
          isModern ? "text-neutral-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" : "text-white"
        )} />
      </div>
    </div>
  );
});
