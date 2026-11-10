import { memo } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderItemThumbnail } from './FolderItemThumbnail';
import { cn } from '../../utils/cn';
import { formatBytes } from '../../utils/formatters';
import { openInExplorer } from '../../utils/electron';

export const FolderContentRow = memo(function FolderContentRow({ item, uiTheme, setSelectedImage, setToast }) {
  const { t } = useTranslation('folders');
  const isMissing = item.exists_on_disk === false;
  const mediaTypeLabels = { image: t('contentRow.mediaType.image'), video: t('contentRow.mediaType.video') };

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-3 rounded-2xl border transition-all",
        isMissing
          ? "border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/20"
          : uiTheme === 'modern'
          ? "border-gray-100 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-800/20 hover:bg-gray-100/80 dark:hover:bg-neutral-800/40"
          : "border-white bg-black hover:border-indigo-400"
      )}
    >
      <FolderItemThumbnail
        item={item}
        uiTheme={uiTheme}
        onSelect={setSelectedImage}
      />

      <div
        className={cn(
          "min-w-0 flex-1",
          isMissing ? "cursor-not-allowed" : "cursor-pointer"
        )}
        onClick={() => {
          if (!isMissing) {
            setSelectedImage({
              path: item.path,
              name: item.name,
              media_type: item.media_type,
              size: item.size,
              isBrowsing: true,
              timestamp_seconds: item.media_type === 'video' ? 1.0 : 0
            });
          }
        }}
        title={isMissing ? t('contentRow.missingTooltip', { name: item.name }) : t('previewTooltip', { name: item.name })}
      >
        <p className={cn(
          "text-sm font-bold truncate",
          isMissing
            ? "text-rose-600 dark:text-rose-400"
            : uiTheme === 'modern'
            ? "text-neutral-800 dark:text-neutral-200 hover:text-indigo-600 dark:hover:text-indigo-400"
            : "text-white"
        )}>
          {item.name}
        </p>
        <p className="text-[10px] text-neutral-500 font-mono truncate mt-1" title={item.relative_path}>
          {item.relative_path}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Indexing Status Badges */}
        <div className="flex items-center gap-1.5">
          {isMissing ? (
            <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30">
              {t('contentRow.badge.missing')}
            </span>
          ) : item.is_indexed ? (
            <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/30">
              {t('contentRow.badge.indexed')}
            </span>
          ) : (
            <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-neutral-700">
              {t('contentRow.badge.notIndexed')}
            </span>
          )}
        </div>

        <div className="text-right min-w-[50px]">
          <span className={cn(
            "inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider",
            item.media_type === 'video'
              ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
              : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          )}>
            {mediaTypeLabels[item.media_type] ?? item.media_type}
          </span>
          {!isMissing && item.size > 0 && (
            <p className="text-[10px] text-neutral-500 mt-1">{formatBytes(item.size)}</p>
          )}
        </div>

        <button
          type="button"
          disabled={isMissing}
          onClick={async (e) => {
            e.stopPropagation();
            // null: no Electron bridge (a plain browser), so there is nothing to report.
            const res = await openInExplorer(item.path);
            if (res !== null && !res?.success) {
              setToast({ type: 'error', message: res?.error || t('common:openFileFailed') });
            }
          }}
          className={cn(
            "p-2 text-neutral-400 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-xl transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed",
            uiTheme !== 'modern' && "border border-white text-white"
          )}
          title={isMissing ? t('contentRow.fileMissing') : t('common:showInExplorer')}
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});
