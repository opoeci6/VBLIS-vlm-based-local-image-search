import { FolderOpen, X, Sparkles, Copy, Video } from 'lucide-react';
import { API_BASE } from '../../config';
import { cn } from '../../utils/cn';
import { formatBytes, formatVideoTimestamp } from '../../utils/formatters';
import { getMediaPreviewUrl } from '../../utils/media';

export const MediaLightbox = ({ selectedImage, setSelectedImage, setToast, uiTheme }) => {
  if (!(selectedImage)) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 py-8 overflow-y-auto animate-in fade-in duration-200 custom-scrollbar"
      onClick={() => setSelectedImage(null)}
    >
      <div className="fixed top-12 right-6 flex gap-4 z-[90]">
        {window.electronAPI && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const res = await window.electronAPI.openInExplorer(selectedImage.path);
              if (res && !res.success) {
                setToast({ message: 'This file has been moved or deleted and is no longer available.', type: 'error' });
              }
            }}
            className="px-4 py-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl flex items-center gap-2 transition-all font-bold backdrop-blur-md border border-white/20 dark:border-neutral-700"
          >
            <FolderOpen className="w-4 h-4" />
            Show in Explorer
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedImage(null);
          }}
          className="p-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl transition-all backdrop-blur-md border border-white/20 dark:border-neutral-700"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <img
        src={getMediaPreviewUrl(API_BASE, selectedImage, 'full')}
        alt={selectedImage.media_type === 'video' ? `Video frame at ${formatVideoTimestamp(selectedImage.timestamp_seconds)}` : 'Full size result'}
        className={cn(
          "max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300",
          selectedImage.isDuplicate ? "max-h-[70vh]" : "max-h-[80vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="mt-6 text-center" onClick={(e) => e.stopPropagation()}>
        {!selectedImage.isBrowsing && selectedImage.score !== undefined && (
          <p className="text-xl font-medium text-white mb-2">
            Match Score: {Math.round(selectedImage.score * 100)}%
          </p>
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
        {selectedImage.media_type === 'video' && (
          <p className={cn(
            "mb-3 inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold",
            uiTheme === 'modern'
              ? "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 rounded-full backdrop-blur-md shadow-lg"
              : "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300"
          )}>
            <Video className="w-4 h-4" />
            Video frame at {formatVideoTimestamp(selectedImage.timestamp_seconds)}
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
                {selectedImage.duplicateType === 'exact' ? 'Exact File Copy' : 'Visual Duplicate (98.5%+ Similarity)'} detected in {selectedImage.otherPaths.length} other location{selectedImage.otherPaths.length > 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 bg-black border border-white text-white rounded-none text-xs font-bold animate-in zoom-in-95 duration-300 shadow-lg">
              {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>
                {selectedImage.duplicateType === 'exact' ? 'Exact File Copy' : 'Visual Duplicate (98.5%+ Similarity)'} detected in {selectedImage.otherPaths.length} other location{selectedImage.otherPaths.length > 1 ? 's' : ''}
              </span>
            </div>
          )
        )}
        <p className={cn(
          "text-xs break-all max-w-3xl mx-auto",
          uiTheme === 'modern' ? "text-neutral-300 font-sans" : "text-neutral-400 font-mono"
        )}>
          {selectedImage.path}
        </p>
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
                <span className="opacity-75">Also found at:</span>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.electronAPI?.openInExplorer) {
                      const res = await window.electronAPI.openInExplorer(p);
                      if (!res?.success) {
                        setToast({ type: 'error', message: res?.error || 'Failed to open file in explorer.' });
                      }
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 cursor-pointer transition-all break-all text-left group",
                    uiTheme === 'modern'
                      ? "text-indigo-300 hover:text-indigo-200 underline underline-offset-2 hover:opacity-100 opacity-90"
                      : "text-white hover:underline underline-offset-2"
                  )}
                  title={`Show ${p} in Explorer`}
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
