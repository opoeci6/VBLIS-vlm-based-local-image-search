"""Which place each file of the media registry lies in, for the Place filter, the filter options and the
`place` of search results.

PlaceResolver turns a registry snapshot (the GPS position of every file) into {registry key: place id} with the
bundled place index (places.py). The mapping is computed once per snapshot and every coordinate is looked up
once for the life of the process (the index never changes), so a registry write costs one pass over the facts,
not a lookup per file. Exceptions are not swallowed here: the callers decide what a failure means.

Depends on places and nothing else.
"""
import threading
from types import MappingProxyType

import places

_NO_PLACES = MappingProxyType({})


class _State:
    """What is remembered for one PlaceIndex (a different index, as in tests, starts from scratch)."""

    def __init__(self, index):
        self.index = index
        self.coordinates = {}  # (lat, lon) -> place id or None
        self.names = {}        # place id -> places.PlaceIndex.describe(id)
        self.cached = None     # (snapshot version, snapshot facts, mapping) of the last snapshot


class PlaceResolver:
    def __init__(self, index_fn=places.get_place_index):
        """`index_fn()` returns a PlaceIndex or None (no place names). It is called on use, never here."""
        self._index_fn = index_fn
        self._lock = threading.Lock()
        self._state = None

    @property
    def available(self):
        return self._index_fn() is not None

    def _state_for(self, index):
        state = self._state
        if state is None or state.index is not index:
            state = self._state = _State(index)
        return state

    def ids(self, snapshot):
        """{registry key: place id} for every file of the snapshot with both coordinates inside a place. The
        mapping is read-only and stays valid for the snapshot; an unavailable index gives an empty one."""
        index = self._index_fn()
        if index is None:
            return _NO_PLACES
        with self._lock:
            state = self._state_for(index)
            cached = state.cached
            if cached is not None and cached[0] == snapshot.version and cached[1] is snapshot.facts:
                return cached[2]
            positions = [(key, (fact.gps_lat, fact.gps_lon)) for key, fact in snapshot.facts.items()
                         if fact.gps_lat is not None and fact.gps_lon is not None]
            coordinates = state.coordinates
            unknown = list(dict.fromkeys(pair for _, pair in positions if pair not in coordinates))
            if unknown:
                coordinates.update(zip(unknown, index.lookup_many(unknown)))
            mapping = {}
            for key, pair in positions:
                place_id = coordinates.get(pair)
                if place_id is not None:
                    mapping[key] = place_id
            mapping = MappingProxyType(mapping)
            state.cached = (snapshot.version, snapshot.facts, mapping)
            return mapping

    def describe(self, place_id):
        """places.PlaceIndex.describe(place_id), remembered; None when unknown or without an index. The
        dict is shared between callers: do not change it."""
        index = self._index_fn()
        if index is None:
            return None
        with self._lock:
            names = self._state_for(index).names
            if place_id not in names:
                names[place_id] = index.describe(place_id)
            return names[place_id]

    def tree(self, counts_by_id):
        """The `places` of the filter options from {place id: number of files}: countries, each with its
        regions, each with its cities, every node {"id", "en", "zh", "count"} (a country and a region also
        "regions" / "cities"). A count includes everything below the node. Every level is sorted by count
        (largest first), then English name (without one last), then id."""
        countries = {}
        for place_id, count in counts_by_id.items():
            parts = places.ancestors(place_id)
            country_id, region_id = parts[0], (parts[1] if len(parts) > 1 else None)
            country = countries.setdefault(country_id, self._node(country_id, "country", {"regions": {}}))
            country["count"] += count
            if region_id is None:
                continue
            region = country["regions"].setdefault(region_id, self._node(region_id, "region", {"cities": {}}))
            region["count"] += count
            if place_id != region_id:
                city = region["cities"].setdefault(place_id, self._node(place_id, "city", {}))
                city["count"] += count
        return _sorted_nodes(countries)

    def _node(self, place_id, level, extra):
        described = self.describe(place_id)
        names = described.get(level) if described else None
        return {"id": place_id, "en": names["en"] if names else None, "zh": names["zh"] if names else None,
                "count": 0, **extra}


def _sorted_nodes(nodes):
    """The nodes of one level (a dict by id) as a list in display order; the children are sorted too."""
    result = []
    for node in nodes.values():
        for child_key in ("regions", "cities"):
            if child_key in node:
                node[child_key] = _sorted_nodes(node[child_key])
        result.append(node)
    result.sort(key=lambda node: (-node["count"], node["en"] is None, (node["en"] or "").casefold(), node["id"]))
    return result
