import { FolderOpen, X, Sparkles, Copy, ClipboardCopy, MapPin, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../config';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { cn } from '../../utils/cn';
import { copyText, openInExplorer } from '../../utils/electron';
import { formatBytes, formatTakenDate, formatVideoTimestamp } from '../../utils/formatters';
import { getMediaPreviewUrl } from '../../utils/media';
import { formatPlaceLine } from '../../utils/placeNames';
import { formatScorePercent, hasScore, isSimilarityKind } from '../../utils/scoreLabel';

export const MediaLightbox = ({ selectedImage, setSelectedImage, setToast, uiTheme }) => {
  // `i18n` is destructured too: it re-renders on a language switch, and the place line is named in that language.
  const { t, i18n } = useTranslation('media');
  const backdropDismiss = useBackdropDismiss(() => setSelectedImage(null));

  if (!(selectedImage)) return null;

  // An item from the library view (no query) has no score: show when it was taken instead.
  const takenDate = formatTakenDate(selectedImage.taken_at);
  // Search and library results carry `place` when the file has GPS data; folder explorer items never do.
  const placeLine = formatPlaceLine(selectedImage.place, i18n.language);
  const duplicateNotice = selectedImage.isDuplicate
    ? (selectedImage.duplicateType === 'exact'
      ? t('lightbox.exactDetected', { count: selectedImage.otherPaths.length })
      : t('lightbox.visualDetected', { count: selectedImage.otherPaths.length }))
    : null;

  const handleCopyPath = async (e) => {
    e.stopPropagation();
    const res = await copyText(selectedImage.path);
    if (res?.success) {
      setToast({ message: t('lightbox.pathCopied'), type: 'success' });
    } else {
      setToast({ message: res?.error || t('lightbox.copyFailed'), type: 'error' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 py-8 overflow-y-auto animate-in fade-in duration-200 custom-scrollbar"
      {...backdropDismiss}
    >
      <div className="fixed top-12 right-6 flex gap-4 z-[90]">
        {window.electronAPI && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const res = await window.electronAPI.openInExplorer(selectedImage.path);
              if (res && !res.success) {
                setToast({ message: t('lightbox.unavailable'), type: 'error' });
              }
            }}
            className="px-4 py-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl flex items-center gap-2 transition-all font-bold backdrop-blur-md border border-white/20 dark:border-neutral-700"
          >
            <FolderOpen className="w-4 h-4" />
            {t('common:showInExplorer')}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedImage(null);
          }}
          aria-label={t('common:close')}
          className="p-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl transition-all backdrop-blur-md border border-white/20 dark:border-neutral-700"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <img
        src={getMediaPreviewUrl(API_BASE, selectedImage, 'full')}
        alt={selectedImage.media_type === 'video' ? t('common:videoFrameAt', { ts: formatVideoTimestamp(selectedImage.timestamp_seconds) }) : t('lightbox.fullSizeAlt')}
        className={cn(
          "max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300",
          selectedImage.isDuplicate ? "max-h-[70vh]" : "max-h-[80vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="mt-6 text-center" onClick={(e) => e.stopPropagation()}>
        {!selectedImage.isBrowsing && hasScore(selectedImage) && (
          <p className="text-xl font-medium text-white mb-2">
            {isSimilarityKind(selectedImage.score_kind)
              ? t('lightbox.similarityScore', { percent: formatScorePercent(selectedImage.score) })
              : t('lightbox.matchScore', { percent: formatScorePercent(selectedImage.score) })}
          </p>
        )}
        {!selectedImage.isBrowsing && !hasScore(selectedImage) && takenDate && (
          <p className="text-xl font-medium text-white mb-2">{t('lightbox.taken', { date: takenDate })}</p>
        )}
        {selectedImage.isBrowsing && (
          <div className="mb-2">
            <p className="text-xl font-medium text-white truncate max-w-3xl px-4 mx-auto" title={selectedImage.name || selectedImage.path}>
              {selectedImage.name || selectedImage.path?.split('\\').pop().split('/').pop()}
            </p>
            {selectedImage.size ? (
              <p className="text-xs text-neutral-400 font-mono mt-0.5">{formatBytes(selectedImage.size)}</p>
            ) : null}
          </div>
        )}
        {placeLine && (
          <p
            className="mb-2 flex items-center justify-center gap-1.5 px-4 text-sm text-neutral-300"
            title={t('lightbox.place', { place: placeLine })}
          >
            <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>{placeLine}</span>
          </p>
        )}
        {selectedImage.media_type === 'video' && (
          <p className={cn(
            "mb-3 inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold",
            uiTheme === 'modern'
              ? "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 rounded-full backdrop-blur-md shadow-lg"
              : "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300"
          )}>
            <Video className="w-4 h-4" />
            {t('common:videoFrameAt', { ts: formatVideoTimestamp(selectedImage.timestamp_seconds) })}
          </p>
        )}
        {selectedImage.isDuplicate && (
          uiTheme === 'modern' ? (
            <div 
              className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold animate-in zoom-in-95 duration-300 shadow-xl border backdrop-blur-md"
              style={{ 
                backgroundColor: `${selectedImage.dupeColor || '#6366f1'}25`,
                borderColor: `${selectedImage.dupeColor || '#6366f1'}60`,
                color: selectedImage.dupeColor || '#a5b4fc',
                boxShadow: `0 0 20px -5px ${selectedImage.dupeColor || '#6366f1'}40`
              }}
            >
              {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>
                {duplicateNotice}
              </span>
            </div>
          ) : (
            <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 bg-black border border-white text-white rounded-none text-xs font-bold animate-in zoom-in-95 duration-300 shadow-lg">
              {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>
                {duplicateNotice}
              </span>
            </div>
          )
        )}
        <div className="flex items-start justify-center gap-2 max-w-3xl mx-auto">
          <p className={cn(
            "text-xs break-all min-w-0",
            uiTheme === 'modern' ? "text-neutral-300 font-sans" : "text-neutral-400 font-mono"
          )}>
            {selectedImage.path}
          </p>
          <button
            type="button"
            onClick={handleCopyPath}
            aria-label={t('lightbox.copyPath')}
            title={t('lightbox.copyPath')}
            className={cn(
              "flex-shrink-0 p-1 transition-all",
              uiTheme === 'modern'
                ? "rounded-md bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white border border-white/15"
                : "rounded-none bg-black border border-white text-white font-mono hover:bg-white hover:text-black"
            )}
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
          </button>
        </div>
        {selectedImage.isDuplicate && (
          <div className="mt-2 space-y-1.5">
            {selectedImage.otherPaths.map(p => (
              <div
                key={p}
                className={cn(
                  "text-[11px] break-all max-w-2xl mx-auto flex items-center justify-center gap-1.5 flex-wrap",
                  uiTheme === 'modern' ? "text-neutral-400 font-sans" : "text-neutral-400 font-mono"
                )}
              >
                <span className="opacity-75">{t('lightbox.alsoFoundAt')}</span>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.electronAPI?.openInExplorer) {
                      const res = await openInExplorer(p);
                      if (!res?.success) {
                        setToast({ type: 'error', message: res?.error || t('common:openFileFailed') });
                      }
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 cursor-pointer transition-all break-all text-left group",
                    uiTheme === 'modern'
                      ? "text-indigo-300 hover:text-indigo-200 underline underline-offset-2 hover:opacity-100 opacity-90"
                      : "text-white hover:underline underline-offset-2"
                  )}
                  title={t('lightbox.showPathInExplorer', { path: p })}
                >
                  <FolderOpen className="w-3 h-3 flex-shrink-0 inline group-hover:scale-110 transition-transform" />
                  <span>{p}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
