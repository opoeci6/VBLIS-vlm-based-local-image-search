"""Offline place names from GPS coordinates.

The data is one bundled file (place_data/places.npz, built by tools/build_places.py from GeoNames
cities500). Every place has an id: "JP" (country), "JP.26" (region, the GeoNames admin1 code) or
"JP.26.1857910" (city, the GeoNames id).

The file holds cities and "sections" (districts and quarters of a city, no names). A coordinate
first finds the nearest row of either kind: its region and country are the answer's region and
country. A section decides the region but is never returned as a city. Beyond CITY_MAX_KM from the
nearest row the answer is the region only, beyond REGION_MAX_KM None. Within CITY_MAX_KM the
answer also names a city, chosen in two steps:

A. Among the cities of that same region within CITY_MAX_KM, the one with the smallest distance
   relative to how far its population lets it "reach" (a big city wins over a nearer small town).
B. A district yields to its metropolis: when step A found nothing, or found a minor administrative
   seat (level 1: a district or ward capital, GeoNames PPLA3/PPLA4), look among the major seats
   (level 2: a national or provincial capital, PPLC/PPLA/PPLA2) of the same region within
   REGION_MAX_KM. The best of them by the same distance / reach measure becomes the city when it
   has at least METRO_MIN_POPULATION people and lies within METRO_COVER_FACTOR * sqrt(population)
   km (a city of 20 million covers 44 km). Otherwise step A's result stands.

Known limits: there are no boundary polygons, so a point near a border can get the neighbour's
region (the nearest row decides it); a ward that GeoNames lists as a major seat (Tokyo's Minato
City) is named instead of the metropolis, and a metropolis in another region than the nearest
row (Jersey City and New York) is not considered.

The file holds numeric arrays only (numpy.load with allow_pickle=False). Names are one UTF-8 byte
block plus an offsets array per name set and are decoded on demand.

Depends on no other backend module except paths.
"""
import datetime
import math
import os
import re
import tempfile
import threading
from pathlib import Path

import numpy as np

import paths

CITY_MAX_KM = 30.0      # within this distance of the nearest place: country, region and city
REGION_MAX_KM = 150.0   # within this: country and region only; farther: no place
# A city "reaches" max(1 km, CITY_REACH_FACTOR * population ** CITY_REACH_POWER) km. The factor is
# chosen so that a place of 1,000 people reaches 0.63 km, the same as the old 0.02 * sqrt(population),
# while big cities reach farther: 10,000 people: 2.8 km, 1,000,000: 56 km, 10,000,000: 252 km
# (under about 2,000 people or an unknown population: 1 km). The city chosen minimizes distance / reach.
CITY_REACH_POWER = 0.65
CITY_REACH_FACTOR = 0.02 * 1000 ** 0.5 / 1000 ** 0.65
# Step B: a major seat (level 2) of at least this many people covers this * sqrt(population) km
METRO_MIN_POPULATION = 5_000_000
METRO_COVER_FACTOR = 0.01
PLACE_ID_PATTERN = r"^[A-Z]{2}(\.[A-Za-z0-9]{1,20}(\.[0-9]{1,10})?)?$"

FORMAT_VERSION = 3

_ID_RE = re.compile(PLACE_ID_PATTERN)
_COUNTRY_RE = re.compile(r"[A-Z]{2}")
_REGION_CODE_RE = re.compile(r"[A-Z]{2}\.[A-Za-z0-9]{1,20}")
_EARTH_RADIUS_KM = 6371.0088
# One degree of latitude is at least 111.19 km, so nothing outside this band can be within
# REGION_MAX_KM of the query; the margin only guards against rounding.
_BAND_DEG = REGION_MAX_KM / 111.0 + 0.01
_MAX_INT32 = 2 ** 31 - 1
# squared chord length of CITY_MAX_KM on the unit sphere (an exact test on the float64 chord lengths)
_CITY_CHORD2 = (2.0 * math.sin(CITY_MAX_KM / (2.0 * _EARTH_RADIUS_KM))) ** 2
# cos of the angle REGION_MAX_KM spans, minus a margin far above float32 rounding (~4e-7)
_COS_MAX = math.cos(REGION_MAX_KM / _EARTH_RADIUS_KM) - 2e-6


def ancestors(place_id):
    """'JP.26.1857910' -> ('JP', 'JP.26', 'JP.26.1857910')."""
    parts = place_id.split(".")
    return tuple(".".join(parts[:i]) for i in range(1, len(parts) + 1))


def place_matches(place_id, chosen_id):
    """True when place_id is chosen_id or lies inside it (the id of a region or country)."""
    return place_id == chosen_id or place_id.startswith(chosen_id + ".")


# ---------------------------------------------------------------- file format


def _pack_strings(strings):
    """Strings -> (uint8 byte block, uint32 offsets of length n + 1)."""
    encoded = [s.encode("utf-8") for s in strings]
    offsets = np.zeros(len(encoded) + 1, dtype=np.int64)
    if encoded:
        np.cumsum([len(b) for b in encoded], out=offsets[1:])
    if offsets[-1] > 2 ** 32 - 1:
        raise ValueError("name block too large")
    return np.frombuffer(b"".join(encoded), dtype=np.uint8), offsets.astype(np.uint32)


def write_places(out_path, countries, regions, cities, build_date=None, source_dates=""):
    """Write a places file.

    countries: iterable of (code, english name, chinese name or "")
    regions:   iterable of (code "CC.ADMIN1", english name or "", chinese name or "")
    cities:    iterable of (geonameid, lat, lon, region code "CC.ADMIN1", english name, chinese name or "",
               population, is_section, level); a section has no names (it only decides the region) and
               level 0. level: 0 ordinary place, 1 minor administrative seat, 2 major seat

    A city whose region is not listed gets a region without a name. Rows are stored sorted by
    latitude (the lookup relies on it). Returns the number of cities written (sections excluded).
    """
    country_rows = {}
    for code, en, zh in countries:
        if not _COUNTRY_RE.fullmatch(code):
            raise ValueError(f"bad country code {code!r}")
        if code in country_rows:
            raise ValueError(f"duplicate country {code}")
        country_rows[code] = (en or "", zh or "")
    country_codes = sorted(country_rows)
    country_index = {code: i for i, code in enumerate(country_codes)}

    region_rows = {}
    for code, en, zh in regions:
        if code in region_rows:
            raise ValueError(f"duplicate region {code}")
        region_rows[code] = (en or "", zh or "")

    city_rows = []
    seen_ids = set()
    for gid, lat, lon, region_code, en, zh, population, is_section, level in cities:
        gid = int(gid)
        if not 0 < gid <= _MAX_INT32 or gid in seen_ids:
            raise ValueError(f"bad or duplicate place id {gid}")
        seen_ids.add(gid)
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"bad coordinates for place {gid}")
        if not isinstance(is_section, (bool, np.bool_)):
            raise ValueError(f"is_section of place {gid} must be a bool")
        if not 0 <= int(population) <= _MAX_INT32:
            raise ValueError(f"bad population for place {gid}")
        if isinstance(level, bool) or level not in (0, 1, 2):
            raise ValueError(f"bad level for place {gid}")
        if is_section and (en or zh):
            raise ValueError(f"section {gid} must not have names")
        if is_section and level != 0:
            raise ValueError(f"section {gid} must have level 0")
        city_rows.append((gid, float(lat), float(lon), region_code, en or "", zh or "", int(population),
                          bool(is_section), int(level)))
        region_rows.setdefault(region_code, ("", ""))

    for code in region_rows:
        if not _REGION_CODE_RE.fullmatch(code):
            raise ValueError(f"bad region code {code!r}")
        if code[:2] not in country_index:
            raise ValueError(f"region {code} refers to an unknown country")
    region_codes = sorted(region_rows)
    region_index = {code: i for i, code in enumerate(region_codes)}

    city_rows.sort(key=lambda row: (np.float32(row[1]), row[0]))

    arrays = {
        "format_version": np.array([FORMAT_VERSION], dtype=np.int32),
        "build_date": np.frombuffer((build_date or datetime.date.today().isoformat()).encode("utf-8"), dtype=np.uint8),
        "source_dates": np.frombuffer(source_dates.encode("utf-8"), dtype=np.uint8),
        "place_lat": np.array([r[1] for r in city_rows], dtype=np.float32),
        "place_lon": np.array([r[2] for r in city_rows], dtype=np.float32),
        "place_geonameid": np.array([r[0] for r in city_rows], dtype=np.int32),
        "place_region": np.array([region_index[r[3]] for r in city_rows], dtype=np.int32),
        "place_population": np.array([r[6] for r in city_rows], dtype=np.int32),
        "place_section": np.array([r[7] for r in city_rows], dtype=np.uint8),
        "place_level": np.array([r[8] for r in city_rows], dtype=np.uint8),
        "region_country": np.array([country_index[c[:2]] for c in region_codes], dtype=np.int32),
    }
    for prefix, values in (
        ("country_code", country_codes),
        ("country_en", [country_rows[c][0] for c in country_codes]),
        ("country_zh", [country_rows[c][1] for c in country_codes]),
        ("region_admin1", [c.split(".", 1)[1] for c in region_codes]),
        ("region_en", [region_rows[c][0] for c in region_codes]),
        ("region_zh", [region_rows[c][1] for c in region_codes]),
        ("place_en", [r[4] for r in city_rows]),
        ("place_zh", [r[5] for r in city_rows]),
    ):
        data, offsets = _pack_strings(values)
        arrays[prefix + "_data"] = data
        arrays[prefix + "_offsets"] = offsets

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # numpy appends ".npz" to a path without it, so write through a file object
    fd, tmp_name = tempfile.mkstemp(prefix=out_path.name + ".", suffix=".tmp", dir=out_path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            np.savez_compressed(f, **arrays)
        os.replace(tmp_name, out_path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return sum(1 for r in city_rows if not r[7])


class _Strings:
    """A name set: one byte block and an offsets array, decoded on demand."""

    def __init__(self, data, offsets):
        if offsets.ndim != 1 or len(offsets) < 1 or int(offsets[0]) != 0 or int(offsets[-1]) != len(data):
            raise ValueError("inconsistent name block")
        if len(offsets) > 1 and bool(np.any(offsets[1:] < offsets[:-1])):
            raise ValueError("inconsistent name offsets")
        self._data = data.tobytes()
        self._offsets = offsets

    def __len__(self):
        return len(self._offsets) - 1

    def get(self, i):
        return self._data[int(self._offsets[i]):int(self._offsets[i + 1])].decode("utf-8")


# ---------------------------------------------------------------- runtime


class PlaceIndex:
    """Nearest-place lookup over the bundled places file. Read-only after load, safe to share."""

    @classmethod
    def load(cls, path=None):
        """Read a places file (default paths.PLACES_FILE). Raises on a missing or broken file."""
        path = Path(paths.PLACES_FILE if path is None else path)
        try:
            # our own file object: numpy leaves the file open when it rejects a truncated archive
            with open(path, "rb") as f, np.load(f, allow_pickle=False) as npz:
                arrays = {name: npz[name] for name in npz.files}
            return cls(arrays)
        except FileNotFoundError:
            raise
        except Exception as e:  # not an npz, truncated, wrong arrays, bad block...
            raise ValueError(f"cannot read places file {path}: {e}") from e

    def __init__(self, arrays):
        version = arrays["format_version"]
        if version.shape != (1,) or int(version[0]) != FORMAT_VERSION:
            raise ValueError("unsupported places format")
        self.build_date = arrays["build_date"].tobytes().decode("utf-8")
        self.source_dates = arrays["source_dates"].tobytes().decode("utf-8")

        self._countries = {n: _Strings(arrays[f"country_{n}_data"], arrays[f"country_{n}_offsets"])
                           for n in ("code", "en", "zh")}
        self._regions = {n: _Strings(arrays[f"region_{n}_data"], arrays[f"region_{n}_offsets"])
                         for n in ("admin1", "en", "zh")}
        self._places = {n: _Strings(arrays[f"place_{n}_data"], arrays[f"place_{n}_offsets"])
                        for n in ("en", "zh")}

        lat = np.ascontiguousarray(arrays["place_lat"], dtype=np.float32)
        lon = np.ascontiguousarray(arrays["place_lon"], dtype=np.float32)
        self._geonameid = arrays["place_geonameid"].astype(np.int32, copy=False)
        self._place_region = arrays["place_region"].astype(np.int32, copy=False)
        self._population = arrays["place_population"].astype(np.int32, copy=False)
        self._section = arrays["place_section"].astype(np.uint8, copy=False)
        self._level = arrays["place_level"].astype(np.uint8, copy=False)
        self._region_country = arrays["region_country"].astype(np.int32, copy=False)
        n = len(lat)
        n_countries, n_regions = len(self._countries["code"]), len(self._regions["admin1"])
        if not (len(lon) == len(self._geonameid) == len(self._place_region) == len(self._places["en"])
                == len(self._places["zh"]) == len(self._population) == len(self._section) == len(self._level) == n):
            raise ValueError("inconsistent place arrays")
        if not (len(self._region_country) == n_regions == len(self._regions["en"]) == len(self._regions["zh"])):
            raise ValueError("inconsistent region arrays")
        if not (n_countries == len(self._countries["en"]) == len(self._countries["zh"])):
            raise ValueError("inconsistent country arrays")
        if n and (self._place_region.min() < 0 or self._place_region.max() >= n_regions):
            raise ValueError("place refers to an unknown region")
        if n_regions and (self._region_country.min() < 0 or self._region_country.max() >= n_countries):
            raise ValueError("region refers to an unknown country")
        if n and (self._population.min() < 0 or self._section.max() > 1):
            raise ValueError("bad population or section flag")
        if n and (self._level.max() > 2 or bool(np.any((self._section == 1) & (self._level != 0)))):
            raise ValueError("bad place level")
        if n > 1 and bool(np.any(lat[1:] < lat[:-1])):
            raise ValueError("places are not sorted by latitude")
        if n and not (bool(np.all(np.isfinite(lat))) and bool(np.all(np.isfinite(lon)))
                      and float(np.abs(lat).max()) <= 90.0 and float(np.abs(lon).max()) <= 180.0):
            raise ValueError("place coordinates out of range")

        self._lat = lat
        self._n_cities = int(n - np.count_nonzero(self._section))
        phi = np.radians(lat.astype(np.float64))
        lam = np.radians(lon.astype(np.float64))
        cos_phi = np.cos(phi)
        self._xyz = np.stack((cos_phi * np.cos(lam), cos_phi * np.sin(lam), np.sin(phi)), axis=1).astype(np.float32)

        self._country_by_code = {self._countries["code"].get(i): i for i in range(n_countries)}
        self._region_ids = [
            self._countries["code"].get(int(self._region_country[r])) + "." + self._regions["admin1"].get(r)
            for r in range(n_regions)
        ]
        self._region_by_id = {rid: r for r, rid in enumerate(self._region_ids)}
        self._order_lock = threading.Lock()
        self._id_order = None

    def __len__(self):
        """Number of cities (sections are not counted)."""
        return self._n_cities

    # -- lookup

    def _search(self, lat, lon, want_city=True):
        """(row of the nearest place, its distance in km, row of the chosen city or None).

        None when no row of any kind lies within REGION_MAX_KM. The nearest row (a city or a
        section) fixes the region; the city is only looked for when that row is within
        CITY_MAX_KM, in the two steps described in the module docstring.
        """
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError, OverflowError):
            return None
        if not (math.isfinite(lat) and math.isfinite(lon)) or abs(lat) > 90.0 or abs(lon) > 180.0:
            return None
        # float32 keys: a float64 key makes numpy copy the whole array to float64 on every call
        lo = int(np.searchsorted(self._lat, np.float32(max(lat - _BAND_DEG, -90.0)), side="left"))
        hi = int(np.searchsorted(self._lat, np.float32(min(lat + _BAND_DEG, 90.0)), side="right"))
        if hi <= lo:
            return None
        phi, lam = math.radians(lat), math.radians(lon)
        query = np.array((math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi)))
        # Unit vectors make the antimeridian and the poles need no special handling. A cheap
        # float32 dot product first drops everything clearly beyond REGION_MAX_KM; the survivors
        # get an exact float64 chord length (a float32 dot product is too coarse at a few km).
        band = self._xyz[lo:hi]
        near = np.flatnonzero(band @ query.astype(np.float32) >= _COS_MAX)
        if near.size == 0:
            return None
        diff = band[near].astype(np.float64) - query
        chord2 = np.einsum("ij,ij->i", diff, diff)
        j = int(np.argmin(chord2))
        km = 2.0 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(float(chord2[j])) / 2.0))
        if km > REGION_MAX_KM:
            return None
        nearest = lo + int(near[j])
        if not want_city or km > CITY_MAX_KM:
            return nearest, km, None
        rows = lo + near
        dist = 2.0 * _EARTH_RADIUS_KM * np.arcsin(np.minimum(1.0, np.sqrt(chord2) / 2.0))
        candidate = (self._section[rows] == 0) & (self._place_region[rows] == self._place_region[nearest])
        # step A: the best city of the region within CITY_MAX_KM
        ok = candidate & (chord2 <= _CITY_CHORD2)
        city = None
        if ok.any():
            city = int(rows[ok][self._best(rows[ok], dist[ok])])
        if city is not None and self._level[city] != 1:
            return nearest, km, city
        # step B: a district (or no city at all) yields to a covering metropolis of the same region
        ok = candidate & (self._level[rows] == 2) & (dist <= REGION_MAX_KM)
        if ok.any():
            k = self._best(rows[ok], dist[ok])
            metro, metro_km = int(rows[ok][k]), float(dist[ok][k])
            population = int(self._population[metro])
            if population >= METRO_MIN_POPULATION and metro_km <= METRO_COVER_FACTOR * math.sqrt(population):
                city = metro
        return nearest, km, city

    def _best(self, rows, dist):
        """Index into rows of the smallest distance / reach; ties: nearer, then lower geonameid."""
        reach = np.maximum(1.0, CITY_REACH_FACTOR * self._population[rows].astype(np.float64) ** CITY_REACH_POWER)
        # lexsort's last key is primary
        return int(np.lexsort((self._geonameid[rows], dist, dist / reach))[0])

    def lookup(self, lat, lon):
        """A city-level id ("JP.26.1857910"), a region-level id ("JP.26") or None."""
        found = self._search(lat, lon)
        if found is None:
            return None
        nearest, _km, city = found
        region_id = self._region_ids[int(self._place_region[nearest])]
        if city is None:
            return region_id
        return f"{region_id}.{int(self._geonameid[city])}"

    def lookup_many(self, coords):
        """lookup for each (lat, lon), in order; a repeated pair is computed once."""
        memo = {}
        result = []
        for lat, lon in coords:
            try:
                key = (lat, lon)
                if key in memo:
                    result.append(memo[key])
                    continue
            except TypeError:  # unhashable; lookup returns None for it
                result.append(None)
                continue
            value = memo[key] = self.lookup(lat, lon)
            result.append(value)
        return result

    def nearest_km(self, lat, lon):
        """Distance in km to the nearest row (city or section), or None when none lies within REGION_MAX_KM."""
        found = self._search(lat, lon, want_city=False)
        return None if found is None else found[1]

    # -- names

    @staticmethod
    def _names(en, zh):
        return {"en": en, "zh": zh or None}

    def _place_index_for_geonameid(self, gid):
        with self._order_lock:
            if self._id_order is None:
                self._id_order = np.argsort(self._geonameid, kind="stable")
            order = self._id_order
        pos = int(np.searchsorted(self._geonameid[order], gid))
        if pos < len(order) and int(self._geonameid[order[pos]]) == gid and not self._section[order[pos]]:
            return int(order[pos])
        return None  # unknown, or a section (never a city)

    def describe(self, place_id):
        """Names for a place id, or None for an unknown or malformed id."""
        if not isinstance(place_id, str) or not _ID_RE.fullmatch(place_id):
            return None
        parts = place_id.split(".")
        c = self._country_by_code.get(parts[0])
        if c is None:
            return None
        country = self._names(self._countries["en"].get(c), self._countries["zh"].get(c))
        result = {"id": place_id, "country": country, "region": None, "city": None}
        if len(parts) == 1:
            return result
        r = self._region_by_id.get(parts[0] + "." + parts[1])
        if r is None:
            return None
        en, zh = self._regions["en"].get(r), self._regions["zh"].get(r)
        result["region"] = self._names(en, zh) if (en or zh) else None
        if len(parts) == 2:
            return result
        i = self._place_index_for_geonameid(int(parts[2]))
        if i is None or int(self._place_region[i]) != r:
            return None
        result["city"] = self._names(self._places["en"].get(i), self._places["zh"].get(i))
        return result

    def _place_id(self, i):
        return f"{self._region_ids[int(self._place_region[i])]}.{int(self._geonameid[i])}"


# ---------------------------------------------------------------- singleton

_singleton_lock = threading.Lock()
_singleton_loaded = False
_singleton = None


def get_place_index():
    """The shared PlaceIndex, loaded on first use. None when the file is missing or broken."""
    global _singleton, _singleton_loaded
    if _singleton_loaded:
        return _singleton
    with _singleton_lock:
        if not _singleton_loaded:
            try:
                _singleton = PlaceIndex.load()
            except Exception as e:
                _singleton = None
                message = f"[Places] Place names are unavailable: {e}"
                try:
                    print(message, flush=True)
                except UnicodeEncodeError:
                    print(message.encode("ascii", "backslashreplace").decode("ascii"), flush=True)
            _singleton_loaded = True
    return _singleton


def _reset_singleton():
    """Forget the loaded index (tests)."""
    global _singleton, _singleton_loaded
    with _singleton_lock:
        _singleton = None
        _singleton_loaded = False
