import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CheckCircle2, Sparkles, Copy, Video } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatTakenDate, formatVideoTimestamp } from '../../utils/formatters';
import { getMediaPreviewUrl } from '../../utils/media';
import { API_BASE } from '../../config';
import { formatScoreLabel, hasScore } from '../../utils/scoreLabel';

export const SearchResultCard = memo(function SearchResultCard({ res, idx, onSelect, uiTheme = 'modern' }) {
  const { t } = useTranslation('search');
  const isModern = uiTheme === 'modern';
  const duplicateCount = res.otherPaths ? res.otherPaths.length + 1 : 2;
  // A library item (no query) has no score: its date taken stands in for it.
  const takenDate = hasScore(res) ? '' : formatTakenDate(res.taken_at);

  return (
    <div
      className={cn(
        "relative group cursor-pointer aspect-square sm:aspect-auto sm:h-[250px] overflow-hidden animate-in fade-in zoom-in-95 fill-mode-both",
        isModern
          ? "rounded-2xl sm:rounded-3xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1"
          : "border border-white bg-black",
        res.isDuplicate && (isModern ? "ring-2" : "border-2")
      )}
      style={{
        animationDelay: `${idx * 50}ms`,
        animationDuration: '400ms',
        boxShadow: isModern && res.isDuplicate ? `0 0 20px -5px ${res.dupeColor}66, 0 0 0 2px ${res.dupeColor}` : undefined
      }}
      onClick={() => onSelect(res)}
    >
      {res.isDuplicate && (
        <div
          className={cn(
            "absolute top-2 left-2 sm:top-3 sm:left-3 z-10 max-w-[62%] sm:max-w-none px-2 py-0.5 sm:px-2.5 sm:py-1 text-[9px] sm:text-[10px] font-bold text-white shadow-lg flex items-center gap-1 sm:gap-1.5",
            isModern ? "rounded-full backdrop-blur-md" : "bg-black border border-white"
          )}
          style={{ backgroundColor: isModern ? `${res.dupeColor || '#6366f1'}ee` : undefined }}
        >
          {res.duplicateType === 'exact' ? <Copy className="w-3 h-3 flex-shrink-0" /> : <Sparkles className="w-3 h-3 flex-shrink-0" />}
          <span className="min-w-0 truncate">
            {res.duplicateType === 'exact' ? t('card.exactCopy', { count: duplicateCount }) : t('card.visualDuplicate', { count: duplicateCount })}
          </span>
        </div>
      )}

      {res.media_type === 'video' && (
        <div
          className={cn(
            "absolute top-2 right-2 sm:top-3 sm:right-3 z-10 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[9px] sm:text-[10px] font-bold shadow-lg flex items-center gap-1 sm:gap-1.5",
            isModern
              ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10"
              : "bg-black text-cyan-300 border border-white"
          )}
        >
          <Video className="w-3 h-3 text-cyan-400" />
          <span>{formatVideoTimestamp(res.timestamp_seconds)}</span>
        </div>
      )}

      <img
        src={getMediaPreviewUrl(API_BASE, res)}
        alt={res.media_type === 'video' ? t('common:videoFrameAt', { ts: formatVideoTimestamp(res.timestamp_seconds) }) : t('card.resultAlt')}
        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        loading="lazy"
      />

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 p-2 sm:p-4 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-300",
          isModern
            ? "bg-gradient-to-t from-black/80 via-black/40 to-transparent"
            : "media-result-overlay bg-black border-t border-white"
        )}
      >
        <div className="translate-y-2 group-hover:translate-y-0 [@media(hover:none)]:translate-y-0 transition-transform duration-300 ease-out">
          {hasScore(res) ? (
            <p className="text-[11px] sm:text-xs font-semibold text-emerald-400 mb-0.5 sm:mb-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {formatScoreLabel(res.score, res.score_kind)}
            </p>
          ) : takenDate ? (
            <p className="text-[11px] sm:text-xs font-semibold text-white/90 mb-0.5 sm:mb-1 flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {takenDate}
            </p>
          ) : null}
          <p className="text-[11px] sm:text-xs text-white/90 truncate font-mono" title={res.path}>
            {res.path.split('\\').pop().split('/').pop()}
          </p>
        </div>
      </div>
    </div>
  );
});
