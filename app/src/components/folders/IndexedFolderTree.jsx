import { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  Video,
  ImageIcon,
  Eye
} from 'lucide-react';
import { SubfolderTreeNode } from './SubfolderTreeNode';
import { buildSubfolderTree } from '../../utils/folderTree';

export const IndexedFolderTree = ({
  folders = [],
  selectedPaths = [],
  onToggleSelection,
  onBrowse,
  onReindex,
  onDelete,
  isIndexing = false,
  uiTheme = 'modern'
}) => {
  // By default, expand all root folders with subfolders if there are 4 or fewer root folders
  const [expandedRoots, setExpandedRoots] = useState(() => {
    const initial = {};
    if (folders.length <= 4) {
      folders.forEach((f) => {
        if (f.subfolder_count > 0) initial[f.path] = true;
      });
    }
    return initial;
  });

  const [expandedSubNodes, setExpandedSubNodes] = useState({});

  const toggleExpand = (path) => {
    setExpandedRoots((prev) => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  const toggleSubNodeExpand = (path) => {
    setExpandedSubNodes((prev) => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  const isModern = uiTheme === 'modern';

  // Build hierarchical subfolder trees with chain compaction for each root folder
  const folderTrees = useMemo(() => {
    return folders.map((f) => ({
      ...f,
      treeChildren: buildSubfolderTree(f.subfolders, f.path)
    }));
  }, [folders]);

  return (
    <div className="space-y-3">
      {folderTrees.map((folder) => {
        const isRootSelected = selectedPaths.includes(folder.path);
        const subfolderPaths = (folder.subfolders || []).map((s) => s.path);
        const selectedSubCount = subfolderPaths.filter((p) => selectedPaths.includes(p)).length;
        const isAllSubsSelected =
          subfolderPaths.length > 0 && selectedSubCount === subfolderPaths.length;
        const isIndeterminate =
          subfolderPaths.length > 0 && selectedSubCount > 0 && !isAllSubsSelected && !isRootSelected;

        const isExpanded = !!expandedRoots[folder.path];
        const hasSubfolders = folder.treeChildren && folder.treeChildren.length > 0;

        const handleRootRowClick = () => {
          if (hasSubfolders) {
            if (!isExpanded) {
              toggleExpand(folder.path);
            } else if (folder.exists) {
              onBrowse(folder);
            }
          } else if (folder.exists) {
            onBrowse(folder);
          }
        };

        const rootTooltip = hasSubfolders
          ? isExpanded
            ? folder.exists
              ? `Click to view media in ${folder.name}`
              : `${folder.name} is missing or inaccessible on disk`
            : `Click to expand ${folder.name}`
          : folder.exists
          ? `Click to view media in ${folder.name}`
          : `${folder.name} is missing or inaccessible on disk`;

        const rootCursorClass = hasSubfolders || folder.exists ? 'cursor-pointer' : 'cursor-not-allowed opacity-90';

        return (
          <div key={folder.path} className="group/root select-none">
            {/* Parent Folder Card */}
            <div
              onClick={handleRootRowClick}
              className={`p-3.5 rounded-2xl border transition-all duration-200 ${rootCursorClass} ${
                isModern
                  ? isRootSelected || isAllSubsSelected
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30 ring-1 ring-indigo-500/10 shadow-xs'
                    : 'bg-gray-50/80 dark:bg-neutral-800/20 border-gray-100 dark:border-neutral-800/60 hover:bg-gray-100/70 dark:hover:bg-neutral-800/50 hover:border-gray-200 dark:hover:border-neutral-700'
                  : isRootSelected || isAllSubsSelected
                  ? 'border-2 border-current font-bold'
                  : 'border border-current'
              } ${!folder.exists ? 'border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5' : ''}`}
              title={rootTooltip}
            >
              <div className="flex items-center justify-between gap-3">
                {/* Left: Checkbox + Expand Button + Folder Info */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Root Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelection(folder.path, false, folder);
                    }}
                    className={`flex items-center justify-center w-5 h-5 rounded-lg border transition-all shrink-0 cursor-pointer ${
                      isRootSelected || isAllSubsSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : isIndeterminate
                        ? 'bg-indigo-100 dark:bg-indigo-500/20 border-indigo-400 text-indigo-600 dark:text-indigo-400'
                        : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-transparent'
                    }`}
                    title={isRootSelected ? 'Deselect folder' : 'Select folder and subfolders'}
                  >
                    {isIndeterminate ? (
                      <div className="w-2.5 h-0.5 bg-current rounded-full" />
                    ) : (
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  {/* Expand / Collapse Button (if subfolders exist) */}
                  {hasSubfolders ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(folder.path);
                      }}
                      className="p-1 text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors shrink-0 cursor-pointer"
                      title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-indigo-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <div className="w-6 shrink-0" />
                  )}

                  {/* Folder Icon Tile */}
                  <div
                    className={`p-2 rounded-xl border shrink-0 ${
                      !folder.exists
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-500 border-rose-200/60 dark:border-rose-500/30'
                        : isModern
                        ? 'bg-white dark:bg-neutral-800 border-gray-200/80 dark:border-neutral-700 shadow-2xs text-indigo-600 dark:text-indigo-400'
                        : 'icon-tile border border-current'
                    }`}
                  >
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4" />
                    ) : (
                      <Folder className="w-4 h-4" />
                    )}
                  </div>

                  {/* Folder Title & Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs font-bold truncate ${
                          folder.exists
                            ? 'text-neutral-900 dark:text-white'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                        title={folder.path}
                      >
                        {folder.name}
                      </span>

                      {!folder.exists && (
                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                          Missing
                        </span>
                      )}

                      {/* Subfolder Count Pill */}
                      {hasSubfolders && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(folder.path);
                          }}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-500/20 transition-colors cursor-pointer"
                        >
                          {folder.subfolder_count} subfolder{folder.subfolder_count > 1 ? 's' : ''}
                        </button>
                      )}

                      {/* High-Contrast Media Stats Badges */}
                      <div className="flex items-center gap-1.5 ml-auto shrink-0">
                        {Boolean(folder.image_count > 0 || (folder.total_disk_image_count > 0)) && (
                          <span
                            className={
                              isModern
                                ? 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/30'
                                : 'inline-flex items-center gap-1 px-2 py-0.5 border border-current text-[10px] font-mono'
                            }
                            title={
                              folder.total_disk_image_count && folder.total_disk_image_count > folder.image_count
                                ? `${folder.image_count} of ${folder.total_disk_image_count} images indexed in this folder tree (${folder.total_disk_image_count - folder.image_count} unindexed)`
                                : `${folder.image_count} total images indexed across this folder tree`
                            }
                          >
                            <ImageIcon className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            <span>
                              {folder.total_disk_image_count && folder.total_disk_image_count > folder.image_count
                                ? `${folder.image_count}/${folder.total_disk_image_count} imgs`
                                : `${folder.image_count} img${folder.image_count > 1 ? 's' : ''}`}
                            </span>
                          </span>
                        )}

                        {Boolean(folder.video_count > 0 || (folder.total_disk_video_count > 0)) && (
                          <span
                            className={
                              isModern
                                ? 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200/80 dark:border-cyan-500/30'
                                : 'inline-flex items-center gap-1 px-2 py-0.5 border border-current text-[10px] font-mono'
                            }
                            title={
                              folder.total_disk_video_count && folder.total_disk_video_count > folder.video_count
                                ? `${folder.video_count} of ${folder.total_disk_video_count} videos indexed in this folder tree (${folder.total_disk_video_count - folder.video_count} unindexed)`
                                : `${folder.video_count} total videos indexed across this folder tree`
                            }
                          >
                            <Video className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                            <span>
                              {folder.total_disk_video_count && folder.total_disk_video_count > folder.video_count
                                ? `${folder.video_count}/${folder.total_disk_video_count} vids`
                                : `${folder.video_count} vid${folder.video_count > 1 ? 's' : ''}`}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    <p
                      className="text-[10px] text-neutral-400 font-mono truncate mt-0.5 max-w-xl"
                      title={folder.path}
                    >
                      {folder.path}
                    </p>
                  </div>
                </div>

                {/* Right: Actions for Root Folder */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (folder.exists) onBrowse(folder);
                    }}
                    disabled={!folder.exists}
                    className="p-1.5 text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title={folder.exists ? "View media gallery & contents" : "Folder is missing or inaccessible on disk"}
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  {/* Re-sync: Kept enabled so user can re-sync when drive is reconnected */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReindex(folder.path);
                    }}
                    disabled={isIndexing}
                    className="p-1.5 text-neutral-400 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-lg transition-all disabled:opacity-30 cursor-pointer"
                    title={folder.exists ? "Re-sync entire folder tree" : "Re-sync folder (e.g. reconnect USB drive)"}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(folder.path);
                    }}
                    disabled={isIndexing}
                    className="p-1.5 text-neutral-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all disabled:opacity-30 cursor-pointer"
                    title="Delete entire folder tree from index"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Nested Recursive Subfolder Hierarchy */}
            {hasSubfolders && isExpanded && (
              <div className="mt-1.5 ml-6 pl-4 border-l-2 border-dashed border-gray-200 dark:border-neutral-700/80 space-y-1.5 py-1 animate-in slide-in-from-top-1 fade-in duration-150">
                {folder.treeChildren.map((subNode) => (
                  <SubfolderTreeNode
                    key={subNode.path}
                    node={subNode}
                    depth={1}
                    selectedPaths={selectedPaths}
                    expandedNodes={expandedSubNodes}
                    onToggleNodeExpand={toggleSubNodeExpand}
                    onToggleSelection={onToggleSelection}
                    onBrowse={onBrowse}
                    onReindex={onReindex}
                    onDelete={onDelete}
                    isIndexing={isIndexing}
                    uiTheme={uiTheme}
                    rootFolder={folder}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
