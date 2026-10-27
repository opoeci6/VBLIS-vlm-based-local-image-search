import { Folder, Video, RefreshCw, FileSearch } from 'lucide-react';

// Icon (and colour) shown for a queue task of the given type.
export const getTaskTypeIcon = (type) => {
  switch (type) {
    case 'INDEX_FOLDERS':
    case 'REINDEX_FOLDER':
    case 'BATCH_REINDEX':
      return <Folder className="w-4 h-4 text-indigo-500" />;
    case 'REBUILD_VIDEO_THUMBNAILS':
      return <Video className="w-4 h-4 text-cyan-500" />;
    case 'SCAN_MEDIA_INFO':
      return <FileSearch className="w-4 h-4 text-violet-500" />;
    default:
      return <RefreshCw className="w-4 h-4 text-emerald-500" />;
  }
};
