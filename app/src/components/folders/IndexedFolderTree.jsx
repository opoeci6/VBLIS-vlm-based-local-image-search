import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Video,
  ImageIcon,
  Eye
} from 'lucide-react';

/**
 * Computes the relative path display label from parent to child,
 * converting path separators into clean breadcrumb dividers (" / ").
 */
function getRelativeSegment(childPath, parentPath) {
  if (!parentPath) return childPath.split(/[\\/]/).pop() || childPath;
  const normalizedChild = childPath.replace(/[\\/]+/g, '/');
  const normalizedParent = parentPath.replace(/[\\/]+/g, '/');

  if (normalizedChild.toLowerCase().startsWith(normalizedParent.toLowerCase())) {
    const rel = normalizedChild.slice(normalizedParent.length).replace(/^\/+/, '');
    if (rel) {
      return rel.replace(/\//g, ' / ');
    }
  }
  return childPath.split(/[\\/]/).pop() || childPath;
}

/**
 * Builds a hierarchical tree from a flat list of subfolders under a root folder,
 * preserving intermediate folder names and chain-compacting single-child paths.
 */
function buildSubfolderTree(subfolders, rootPath) {
  if (!subfolders || subfolders.length === 0) return [];

  const nodeMap = new Map();

  subfolders.forEach((sub) => {
    nodeMap.set(sub.path, {
      ...sub,
      direct_image_count: sub.image_count || 0,
      direct_video_count: sub.video_count || 0,
      total_image_count: sub.image_count || 0,
      total_video_count: sub.video_count || 0,
      direct_disk_image_count: sub.direct_disk_image_count || sub.image_count || 0,
      direct_disk_video_count: sub.direct_disk_video_count || sub.video_count || 0,
      disk_image_count: sub.disk_image_count || sub.image_count || 0,
      disk_video_count: sub.disk_video_count || sub.video_count || 0,
      children: [],
      descendantPaths: []
    });
  });

  const rootChildren = [];
  const sortedSubs = [...subfolders].sort((a, b) => (a.depth || 1) - (b.depth || 1));

  sortedSubs.forEach((sub) => {
    const node = nodeMap.get(sub.path);
    let parentPath = null;
    let currentDir = sub.path;

    while (true) {
      const parentDir =
        currentDir.split(/[\\/]/).slice(0, -1).join(currentDir.includes('/') ? '/' : '\\') || '';
      if (!parentDir || parentDir === currentDir) break;
      if (nodeMap.has(parentDir)) {
        parentPath = parentDir;
        break;
      }
      if (parentDir.toLowerCase() === rootPath.toLowerCase()) {
        break;
      }
      currentDir = parentDir;
    }

    if (parentPath && nodeMap.has(parentPath)) {
      node.name = getRelativeSegment(node.path, parentPath);
      nodeMap.get(parentPath).children.push(node);
    } else {
      node.name = getRelativeSegment(node.path, rootPath);
      rootChildren.push(node);
    }
  });

  function processNode(node) {
    const childDescendants = [];
    let childImages = 0;
    let childVideos = 0;
    let childDiskImages = 0;
    let childDiskVideos = 0;

    node.children.forEach((child) => {
      processNode(child);
      childDescendants.push(child.path, ...child.descendantPaths);
      childImages += child.total_image_count;
      childVideos += child.total_video_count;
      childDiskImages += child.disk_image_count;
      childDiskVideos += child.disk_video_count;
    });

    node.descendantPaths = childDescendants;
    node.total_image_count = node.direct_image_count + childImages;
    node.total_video_count = node.direct_video_count + childVideos;
    node.disk_image_count = node.direct_disk_image_count + childDiskImages;
    node.disk_video_count = node.direct_disk_video_count + childDiskVideos;

    // Chain Compaction: If intermediate node has 0 direct items & exactly 1 child, compact names
    if (
      node.direct_image_count === 0 &&
      node.direct_video_count === 0 &&
      node.children.length === 1
    ) {
      const onlyChild = node.children[0];
      node.name = `${node.name} / ${onlyChild.name}`;
      node.path = onlyChild.path;
      node.relative_path = onlyChild.relative_path;
      node.exists = onlyChild.exists;
      node.direct_image_count = onlyChild.direct_image_count;
      node.direct_video_count = onlyChild.direct_video_count;
      node.total_image_count = onlyChild.total_image_count;
      node.total_video_count = onlyChild.total_video_count;
      node.disk_image_count = onlyChild.disk_image_count;
      node.disk_video_count = onlyChild.disk_video_count;
      node.children = onlyChild.children;
      node.descendantPaths = onlyChild.descendantPaths;
    }

    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  rootChildren.forEach((rootChild) => processNode(rootChild));
  rootChildren.sort((a, b) => a.name.localeCompare(b.name));

  return rootChildren;
}

/**
 * Recursive Subfolder Tree Node Component
 */
const SubfolderTreeNode = ({
  node,
  depth = 1,
  selectedPaths = [],
  expandedNodes = {},
  onToggleNodeExpand,
  onToggleSelection,
  onBrowse,
  onReindex,
  onDelete,
  isIndexing = false,
  uiTheme = 'modern',
  rootFolder
}) => {
  const isModern = uiTheme === 'modern';
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = !!expandedNodes[node.path];

  const isSelected = selectedPaths.includes(node.path);
  const descendantSelectedCount = (node.descendantPaths || []).filter((p) =>
    selectedPaths.includes(p)
  ).length;
  const isAllDescendantsSelected =
    node.descendantPaths &&
    node.descendantPaths.length > 0 &&
    descendantSelectedCount === node.descendantPaths.length;
  const isIndeterminate =
    node.descendantPaths &&
    node.descendantPaths.length > 0 &&
    descendantSelectedCount > 0 &&
    !isAllDescendantsSelected &&
    !isSelected;

  const handleRowClick = () => {
    if (hasChildren) {
      if (!isExpanded) {
        onToggleNodeExpand(node.path);
      } else if (node.exists) {
        onBrowse(node);
      }
    } else if (node.exists) {
      onBrowse(node);
    }
  };

  const rowTooltip = hasChildren
    ? isExpanded
      ? node.exists
        ? `Click to view media in ${node.name}`
        : `${node.name} is missing or inaccessible on disk`
      : `Click to expand ${node.name}`
    : node.exists
    ? `Click to view media in ${node.name}`
    : `${node.name} is missing or inaccessible on disk`;

  const cursorClass = hasChildren || node.exists ? 'cursor-pointer' : 'cursor-not-allowed opacity-90';

  return (
    <div className="group/subnode select-none">
      <div
        onClick={handleRowClick}
        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all duration-150 ${cursorClass} ${
          isModern
            ? isSelected || isAllDescendantsSelected
              ? 'bg-cyan-50/90 dark:bg-cyan-950/30 border-cyan-300 dark:border-cyan-500/40 shadow-xs'
              : 'bg-white/80 dark:bg-neutral-800/40 border-gray-100 dark:border-neutral-800/80 hover:bg-gray-100/70 dark:hover:bg-neutral-800/80 hover:border-cyan-200 dark:hover:border-cyan-500/30'
            : isSelected || isAllDescendantsSelected
            ? 'border-2 border-current font-bold'
            : 'border border-current'
        } ${!node.exists ? 'border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5' : ''}`}
        title={rowTooltip}
      >
        {/* Left: Checkbox + Expand Button + Folder Icon + Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Subfolder Checkbox */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection(node.path, true, node);
            }}
            className={`flex items-center justify-center w-4 h-4 rounded-md border transition-all shrink-0 cursor-pointer ${
              isSelected || isAllDescendantsSelected
                ? 'bg-cyan-600 border-cyan-600 text-white'
                : isIndeterminate
                ? 'bg-cyan-100 dark:bg-cyan-500/20 border-cyan-400 text-cyan-600 dark:text-cyan-400'
                : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-transparent'
            }`}
            title={isSelected ? 'Deselect folder' : 'Select folder and subfolders'}
          >
            {isIndeterminate ? (
              <div className="w-2 h-0.5 bg-current rounded-full" />
            ) : (
              <svg
                className="w-3 h-3"
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

          {/* Expand/Collapse Chevron (if node has children) */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleNodeExpand(node.path);
              }}
              className="p-0.5 text-neutral-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors shrink-0 cursor-pointer"
              title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}

          {/* Folder Icon Tile */}
          <div className={`p-1.5 rounded-lg shrink-0 border ${
            node.exists
              ? 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400 border-cyan-200/50 dark:border-cyan-500/20'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-500 border-rose-200/60 dark:border-rose-500/30'
          }`}>
            {hasChildren && isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5" />
            ) : (
              <Folder className="w-3.5 h-3.5" />
            )}
          </div>

          {/* Folder Title & Info */}
          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold truncate ${
                node.exists
                  ? 'text-neutral-800 dark:text-neutral-200'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
              title={node.path}
            >
              {node.name}
            </span>

            {!node.exists && (
              <span className="text-[9px] uppercase tracking-wider font-extrabold text-rose-500 bg-rose-500/10 px-1 py-0.2 rounded whitespace-nowrap">
                Missing
              </span>
            )}

            {/* Subfolder Count Pill on nested nodes */}
            {hasChildren && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleNodeExpand(node.path);
                }}
                className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-200/60 dark:border-cyan-500/20 transition-colors cursor-pointer"
              >
                {node.children.length} subfolder{node.children.length > 1 ? 's' : ''}
              </button>
            )}

            {/* High-Contrast Media Count Badges */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {Boolean(node.total_image_count > 0 || (node.disk_image_count > 0)) && (
                <span
                  className={
                    isModern
                      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/30'
                      : 'inline-flex items-center gap-1 px-1.5 py-0.5 border border-current text-[10px] font-mono'
                  }
                  title={
                    node.disk_image_count && node.disk_image_count > node.total_image_count
                      ? `${node.total_image_count} of ${node.disk_image_count} images indexed in this folder (${node.disk_image_count - node.total_image_count} unindexed)`
                      : `${node.total_image_count} image${node.total_image_count > 1 ? 's' : ''} indexed in this folder`
                  }
                >
                  <ImageIcon className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  <span>
                    {node.disk_image_count && node.disk_image_count > node.total_image_count
                      ? `${node.total_image_count}/${node.disk_image_count} imgs`
                      : `${node.total_image_count} img${node.total_image_count > 1 ? 's' : ''}`}
                  </span>
                </span>
              )}

              {Boolean(node.total_video_count > 0 || (node.disk_video_count > 0)) && (
                <span
                  className={
                    isModern
                      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200/80 dark:border-cyan-500/30'
                      : 'inline-flex items-center gap-1 px-1.5 py-0.5 border border-current text-[10px] font-mono'
                  }
                  title={
                    node.disk_video_count && node.disk_video_count > node.total_video_count
                      ? `${node.total_video_count} of ${node.disk_video_count} videos indexed in this folder (${node.disk_video_count - node.total_video_count} unindexed)`
                      : `${node.total_video_count} video${node.total_video_count > 1 ? 's' : ''} indexed in this folder`
                  }
                >
                  <Video className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                  <span>
                    {node.disk_video_count && node.disk_video_count > node.total_video_count
                      ? `${node.total_video_count}/${node.disk_video_count} vids`
                      : `${node.total_video_count} vid${node.total_video_count > 1 ? 's' : ''}`}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions for Subfolder */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (node.exists) onBrowse(node);
            }}
            disabled={!node.exists}
            className="p-1.5 text-neutral-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={node.exists ? "View media gallery & contents" : "Folder is missing or inaccessible on disk"}
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          {/* Re-sync: Kept enabled so user can re-sync when drive is reconnected */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReindex(node.path);
            }}
            disabled={isIndexing}
            className="p-1.5 text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors disabled:opacity-30 cursor-pointer"
            title={node.exists ? "Re-sync only this subfolder" : "Re-sync subfolder (e.g. reconnect USB drive)"}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.path);
            }}
            disabled={isIndexing}
            className="p-1.5 text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors disabled:opacity-30 cursor-pointer"
            title="Delete only this subfolder from index"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Recursive Children (Nested Subfolders) */}
      {hasChildren && isExpanded && (
        <div className="mt-1.5 ml-4 pl-3.5 border-l-2 border-dashed border-gray-200 dark:border-neutral-700/80 space-y-1.5 py-0.5 animate-in slide-in-from-top-1 fade-in duration-150">
          {node.children.map((child) => (
            <SubfolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPaths={selectedPaths}
              expandedNodes={expandedNodes}
              onToggleNodeExpand={onToggleNodeExpand}
              onToggleSelection={onToggleSelection}
              onBrowse={onBrowse}
              onReindex={onReindex}
              onDelete={onDelete}
              isIndexing={isIndexing}
              uiTheme={uiTheme}
              rootFolder={rootFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

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
