// Pure helpers for places: names in the interface language, the one-line place text of the lightbox and
// the selection rules of the Place filter. Kept free of React so they are easy to test.
//
// A place id has 1 to 3 dot-separated parts: a country or region ("JP"), a region ("JP.22") or a city
// ("JP.22.1857910"). A name object is { en, zh }: `zh` may be null (then the English name is used), and a
// region GeoNames has no name for has both null.

const isChinese = (language) => String(language ?? '').toLowerCase().startsWith('zh');

// The name to show for { en, zh }: the Chinese one when the interface is Chinese and the file has it,
// else the English one. '' when there is nothing to show (null-safe), so callers can fall back with `||`.
export function placeName(names, language) {
  if (!names) return '';
  if (isChinese(language) && names.zh) return names.zh;
  return names.en || '';
}

// Collapses runs of equal neighbours ("Kyoto, Kyoto, Japan" -> "Kyoto, Japan").
const withoutAdjacentRepeats = (parts) => parts.filter((part, index) => index === 0 || part !== parts[index - 1]);

// One line for a result's place ({ country, region, city }, the last two may be null): English runs from
// small to large ("Kyoto, Japan"), Chinese from large to small ("日本 · 京都市"). '' when nothing is known.
export function formatPlaceLine(place, language) {
  if (!place) return '';
  const parts = [place.city, place.region, place.country]
    .map(names => placeName(names, language))
    .filter(Boolean);
  if (isChinese(language)) return withoutAdjacentRepeats(parts.reverse()).join(' · ');
  return withoutAdjacentRepeats(parts).join(', ');
}

// True when `id` lies below `ancestorId` ("JP.22" is inside "JP"; "JP" is not inside itself).
export function isPlaceInside(id, ancestorId) {
  if (typeof id !== 'string' || typeof ancestorId !== 'string' || !ancestorId) return false;
  return id.startsWith(`${ancestorId}.`);
}

export function isPlaceSelected(selected, id) {
  return selected.some(entry => entry.id === id);
}

// The selected place that already covers `id` (a strict ancestor), or null.
export function findSelectedPlaceAncestor(selected, id) {
  return selected.find(entry => isPlaceInside(id, entry.id)) ?? null;
}

// Toggle one place node ({ id, en, zh }) in the selection, with the rules of toggleFolderSelection:
//  - selected: it is removed;
//  - an ancestor is selected: nothing changes (it is already included);
//  - otherwise it is added and any selected descendants are dropped (the new place covers them).
// An entry keeps the node's own names, so the chip can be named without the options. Returns the same
// array when nothing changes.
export function togglePlaceSelection(selected, node) {
  if (isPlaceSelected(selected, node.id)) return selected.filter(entry => entry.id !== node.id);
  if (findSelectedPlaceAncestor(selected, node.id)) return selected;
  return [
    ...selected.filter(entry => !isPlaceInside(entry.id, node.id)),
    { id: node.id, en: node.en ?? null, zh: node.zh ?? null },
  ];
}
