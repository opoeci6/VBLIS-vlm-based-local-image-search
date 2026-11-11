import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../../utils/formatters';
import { findSelectedPlaceAncestor, isPlaceSelected, placeName } from '../../../utils/placeNames';
import { FilterToggle } from './FilterToggle';

const formatCount = (value) => formatNumber(Number(value || 0));

// A country or region has regions, a region has cities, a city has nothing below it.
const childrenOf = (node) => node.regions ?? node.cities ?? [];

const PlaceNode = ({ node, depth, selected, expanded, onToggle, onToggleExpanded }) => {
  const { t, i18n } = useTranslation('filters');
  // A region GeoNames has no name for has neither name: it is listed as "Other".
  const name = placeName(node, i18n.language) || t('place.other');
  const isSelected = isPlaceSelected(selected, node.id);
  // A place below a selected one is already searched: shown as included, and toggling does nothing.
  const included = !isSelected && Boolean(findSelectedPlaceAncestor(selected, node.id));
  const children = childrenOf(node);
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(node.id);

  return (
    <li>
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? t('tree.collapse', { name }) : t('tree.expand', { name })}
            aria-expanded={isExpanded}
            onClick={() => onToggleExpanded(node.id)}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="h-7 w-7 flex-shrink-0" aria-hidden="true" />
        )}
        <FilterToggle
          pressed={isSelected || included}
          aria-disabled={included ? true : undefined}
          onClick={() => { if (!included) onToggle(node); }}
          className={`min-w-0 flex-1 justify-between text-left ${included ? 'cursor-default' : ''}`}
        >
          <span className="truncate">{name}</span>
          <span className="flex flex-shrink-0 items-center gap-2 font-normal">
            {included && <span>{t('tree.included')}</span>}
            <span>{formatCount(node.count)}</span>
          </span>
        </FilterToggle>
      </div>
      {hasChildren && isExpanded && (
        <ul>
          {children.map(child => (
            <PlaceNode
              key={child.id}
              node={child}
              depth={depth + 1}
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

// The places of the filter options (countries or regions, each with its regions and their cities) as an
// expandable tree of filter toggles. `selected` holds { id, en, zh } entries; `onToggle` gets a tree node.
export const PlaceFilterTree = ({ places, selected, onToggle }) => {
  const { t } = useTranslation('filters');
  const [expanded, setExpanded] = useState(() => new Set());
  const onToggleExpanded = useCallback((id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">{t('place.countryOrRegion')}</p>
      <ul className="max-h-52 overflow-y-auto custom-scrollbar">
        {places.map(node => (
          <PlaceNode
            key={node.id}
            node={node}
            depth={0}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onToggleExpanded={onToggleExpanded}
          />
        ))}
      </ul>
    </div>
  );
};
