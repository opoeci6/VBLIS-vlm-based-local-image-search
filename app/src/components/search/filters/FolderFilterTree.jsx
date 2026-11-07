import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { buildSubfolderTree } from '../../../utils/folderTree';
import { findSelectedAncestor, isFolderSelected } from '../../../utils/searchFilters';
import { FilterToggle } from './FilterToggle';

const formatCount = (value) => Number(value || 0).toLocaleString('en-US');

// Connected folders first, folders that are missing from disk after them; each group keeps its order.
const connectedFirst = (items) => [
  ...items.filter(item => item.exists !== false),
  ...items.filter(item => item.exists === false),
];

const FolderNode = ({ path, name, count, exists, depth, nodes, selected, expanded, onToggle, onToggleExpanded }) => {
  const isSelected = isFolderSelected(selected, path);
  // A folder below a selected one is already searched: shown as included, and toggling does nothing.
  const included = !isSelected && Boolean(findSelectedAncestor(selected, path));
  // A folder that is missing from disk cannot be chosen. One chosen before its drive was unplugged
  // stays pressed and can still be deselected.
  const missing = exists === false;
  const blocked = included || (missing && !isSelected);
  const hasChildren = nodes.length > 0;
  const isExpanded = expanded.has(path);

  return (
    <li>
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name}`}
            aria-expanded={isExpanded}
            onClick={() => onToggleExpanded(path)}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="h-7 w-7 flex-shrink-0" aria-hidden="true" />
        )}
        <FilterToggle
          pressed={isSelected || included}
          aria-disabled={blocked ? true : undefined}
          onClick={() => { if (!blocked) onToggle(path); }}
          title={missing ? `${name} is missing or inaccessible on disk` : path}
          className={`min-w-0 flex-1 justify-between text-left ${blocked ? 'cursor-default' : ''}`}
        >
          <span className={`truncate ${missing ? 'text-rose-600 dark:text-rose-400' : ''}`}>{name}</span>
          <span className="flex flex-shrink-0 items-center gap-2 font-normal">
            {included && <span>(included)</span>}
            {missing && (
              <span className="text-[9px] uppercase tracking-wider font-extrabold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                Missing
              </span>
            )}
            <span>{formatCount(count)}</span>
          </span>
        </FilterToggle>
      </div>
      {hasChildren && isExpanded && (
        <ul>
          {connectedFirst(nodes).map(child => (
            <FolderNode
              key={child.path}
              path={child.path}
              name={child.name}
              count={(child.total_image_count || 0) + (child.total_video_count || 0)}
              exists={child.exists}
              depth={depth + 1}
              nodes={child.children}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

// Indexed folders (roots with their subfolders as an expandable tree) as filter toggles.
export const FolderFilterTree = ({ indexedFolders, selected, onToggle }) => {
  const [expanded, setExpanded] = useState(() => new Set());
  const trees = useMemo(
    () => connectedFirst((indexedFolders || []).map(root => (
      { root, exists: root.exists, children: buildSubfolderTree(root.subfolders, root.path) }
    ))),
    [indexedFolders]
  );
  const onToggleExpanded = useCallback((path) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (trees.length === 0) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">No indexed folders</p>;
  }

  return (
    <ul className="max-h-52 overflow-y-auto custom-scrollbar">
      {trees.map(({ root, children }) => (
        <FolderNode
          key={root.path}
          path={root.path}
          name={root.name || root.path}
          count={root.item_count ?? (root.image_count || 0) + (root.video_count || 0)}
          exists={root.exists}
          depth={0}
          nodes={children}
          selected={selected}
          expanded={expanded}
          onToggle={onToggle}
          onToggleExpanded={onToggleExpanded}
        />
      ))}
    </ul>
  );
};
