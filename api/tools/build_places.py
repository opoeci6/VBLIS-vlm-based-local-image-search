"""Build api/place_data/places.npz from the GeoNames dumps. A developer tool, never imported by the app.

    python -I api/tools/build_places.py --source <folder> --opencc <folder> --out api/place_data/places.npz

--opencc is a folder holding the OpenCC package (opencc-python-reimplemented, installed with
pip --target); it converts every Chinese name to Simplified Chinese. <folder> holds cities500.zip, alternateNamesV2.zip, admin1CodesASCII.txt and countryInfo.txt, all
from https://download.geonames.org/export/dump/ (CC BY 4.0, credit GeoNames). The downloads are
untrusted data: the zips are read member by member with zipfile and nothing is extracted to disk.
"""
import argparse
import datetime
import re
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import places  # noqa: E402

CITIES_ZIP = "cities500.zip"
ALT_NAMES_ZIP = "alternateNamesV2.zip"
ADMIN1_FILE = "admin1CodesASCII.txt"
COUNTRY_FILE = "countryInfo.txt"

# Historical, abandoned, destroyed places and historical capitals are left out
EXCLUDED_FEATURE_CODES = {"PPLH", "PPLQ", "PPLW", "PPLCH"}
# Sections of cities (districts, quarters) are kept without names: the lookup uses them only to
# find the region, never as a city
SECTION_FEATURE_CODE = "PPLX"
MAX_INT32 = 2 ** 31 - 1
# Level of a place (see places.write_places): 1 minor administrative seat, 2 major seat
LEVEL_BY_FEATURE_CODE = {"PPLA3": 1, "PPLA4": 1, "PPLC": 2, "PPLA": 2, "PPLA2": 2}
# Simplified Chinese first; Traditional variants (zh-TW, zh-Hant, zh-HK) come last and are used only
# when nothing else exists: every Chinese name goes through OpenCC t2s afterwards
ZH_PRIORITY = [b"zh-cn", b"zh-hans", b"zh-sg", b"zh", b"zh-hant", b"zh-tw", b"zh-hk"]
# The wording of these three country names is a project decision (they stay separate entries)
ZH_COUNTRY_NAMES = {"HK": "香港（中国）", "MO": "澳门（中国）", "TW": "台湾（中国）"}
# GeoNames' one region for most of Taiwan is itself called "Taiwan": it gets the same Chinese name as the
# entry above it, so that a place line shows the name once in Chinese as it does in English
ZH_REGION_NAMES = {"TW.04": ZH_COUNTRY_NAMES["TW"]}
# Here the "cities" of GeoNames are neighbourhoods and housing estates, mostly without a Chinese name:
# their rows are kept as sections, so a position is named by its district (the region) only
REGION_ONLY_COUNTRIES = {"HK", "MO"}
# Hand-kept corrections, applied last: lines of "geonameid <tab> Chinese name <tab> note", # for comments
OVERRIDES_FILE = Path(__file__).with_name("place_name_overrides.tsv")
ZH_RANK = {lang: rank for rank, lang in enumerate(ZH_PRIORITY)}
# Thousands of places in China have their Chinese names only as alternate names without a language
# (太仓市 for Taicang). For places of these countries such a name, when it is all Chinese characters, is
# used after every tagged one. Several often exist (the city and its seat town: 太仓市, 城厢镇), so the
# name of the larger kind of unit wins, then the oldest entry.
UNTAGGED_ZH_COUNTRIES = {"CN", "HK", "MO", "TW"}
UNTAGGED_ZH_RANK = len(ZH_PRIORITY)
UNTAGGED_ZH_SUFFIXES = ("市", "区", "區", "县", "縣", "旗", "镇", "鎮", "乡", "鄉", "街道")
ZH_UNIT_SUFFIXES = ("市", "县", "縣", "旗")
HAN_RE =re.compile(r"[㐀-䶿一-鿿]+")
MAX_MEMBER_BYTES = 2 * 1024 ** 3
ADMIN1_RE = re.compile(r"[A-Za-z0-9]{1,20}")
COUNTRY_RE = re.compile(r"[A-Z]{2}")


def _member(zf, name):
    info = zf.getinfo(name)
    if info.file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"{name} is unexpectedly large ({info.file_size} bytes)")
    return info


def _clean(text):
    """A name without surrounding space; "" when it is empty or holds control characters."""
    text = text.strip()
    return "" if any(ord(c) < 32 or ord(c) == 127 for c in text) else text


def _first_alternative(name):
    """'臺灣省 or 台灣省' -> '臺灣省': GeoNames sometimes lists two spellings in one name."""
    return name.split(" or ", 1)[0].strip()


def _text_rows(raw_lines):
    for raw in raw_lines:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if line and not line.startswith("#"):
            yield line.split("\t")


def read_countries(path):
    """{code: (english name, geonameid)} from countryInfo.txt."""
    countries = {}
    with open(path, "rb") as f:
        for cols in _text_rows(f):
            if len(cols) < 17 or not COUNTRY_RE.fullmatch(cols[0]):
                continue
            name = _clean(cols[4])
            if name and cols[16].isdigit():
                countries[cols[0]] = (name, int(cols[16]))
    return countries


def read_admin1(path):
    """{"CC.ADMIN1": (english name, geonameid)} from admin1CodesASCII.txt."""
    regions = {}
    with open(path, "rb") as f:
        for cols in _text_rows(f):
            if len(cols) < 4 or "." not in cols[0]:
                continue
            cc, admin1 = cols[0].split(".", 1)
            name = _clean(cols[2]) or _clean(cols[1])
            if COUNTRY_RE.fullmatch(cc) and ADMIN1_RE.fullmatch(admin1) and cols[3].isdigit():
                regions[cols[0]] = (name, int(cols[3]))
    return regions


def read_cities(zip_path):
    """Kept rows of cities500: (geonameid, lat, lon, country code, admin1, name, population, is_section, level).

    A section has an empty name and level 0. Also returns the zip date.
    """
    rows = []
    with zipfile.ZipFile(zip_path) as zf:
        info = _member(zf, "cities500.txt")
        date = datetime.datetime(*info.date_time).date().isoformat()
        with zf.open(info) as f:
            for cols in _text_rows(f):
                if len(cols) < 15 or cols[6] != "P" or cols[7] in EXCLUDED_FEATURE_CODES:
                    continue
                is_section = cols[7] == SECTION_FEATURE_CODE
                try:
                    gid, lat, lon = int(cols[0]), float(cols[4]), float(cols[5])
                except ValueError:
                    continue
                if not (-90 <= lat <= 90 and -180 <= lon <= 180) or not COUNTRY_RE.fullmatch(cols[8]):
                    continue
                admin1 = cols[10] if ADMIN1_RE.fullmatch(cols[10]) else "00"
                name = "" if is_section else (_clean(cols[1]) or _clean(cols[2]))
                if not name and not is_section:
                    continue
                try:
                    population = min(max(int(cols[14] or 0), 0), MAX_INT32)
                except ValueError:
                    population = 0
                level = 0 if is_section else LEVEL_BY_FEATURE_CODE.get(cols[7], 0)
                rows.append((gid, lat, lon, cols[8], admin1, name, population, is_section, level))
    return rows, date


def _untagged_suffix_rank(name):
    for rank, suffix in enumerate(UNTAGGED_ZH_SUFFIXES):
        if name.endswith(suffix):
            return rank
    return len(UNTAGGED_ZH_SUFFIXES)


def scan_alternate_names(zip_path, wanted_ids, city_ids, untagged_ids=()):
    """Stream alternateNamesV2.

    Returns (english, chinese, date): english maps a place geonameid to its preferred English
    name; chinese maps a geonameid to (name, language) following ZH_PRIORITY. For the geonameids in
    untagged_ids a name without a language that is all Chinese characters is used when no tagged
    Chinese name exists (language "untagged").
    """
    wanted = {str(i).encode("ascii") for i in wanted_ids}
    cities = {str(i).encode("ascii") for i in city_ids}
    untagged = {str(i).encode("ascii") for i in untagged_ids}
    english = {}   # gid bytes -> (alternate name id, name)
    chinese = {}   # gid bytes -> ((language rank, not preferred, alternate name id), name, language)
    with zipfile.ZipFile(zip_path) as zf:
        info = _member(zf, "alternateNamesV2.txt")
        date = datetime.datetime(*info.date_time).date().isoformat()
        with zf.open(info) as f:
            for raw in f:
                parts = raw.split(b"\t", 9)
                if len(parts) < 4 or parts[1] not in wanted:
                    continue
                lang = parts[2].lower()
                is_en = lang == b"en"
                rank = ZH_RANK.get(lang)
                is_untagged = lang == b"" and parts[1] in untagged
                if is_untagged:
                    rank = UNTAGGED_ZH_RANK
                if not is_en and rank is None:
                    continue
                flag = [parts[i] if len(parts) > i else b"" for i in range(8)]
                if flag[6] == b"1" or flag[7] == b"1":  # colloquial, historic
                    continue
                preferred = flag[4] == b"1"
                if is_en and not (preferred and parts[1] in cities):
                    continue
                try:
                    alt_id = int(parts[0])
                    name = _clean(parts[3].decode("utf-8"))
                    if not is_en:
                        name = _first_alternative(name)
                except ValueError:
                    continue
                if not name or (is_untagged and not HAN_RE.fullmatch(name)):
                    continue
                gid = parts[1]
                if is_en:
                    if gid not in english or alt_id < english[gid][0]:
                        english[gid] = (alt_id, name)
                else:
                    # In these countries GeoNames often lists the seat town's name next to the city's or
                    # county's (玉山 and 昆山市 for Kunshan): the name of the city, county or banner comes
                    # first, whatever its language tag
                    is_unit = gid in untagged and name.endswith(ZH_UNIT_SUFFIXES)
                    key = (int(not is_unit), rank, _untagged_suffix_rank(name) if is_untagged else int(not preferred),
                           alt_id)
                    if gid not in chinese or key < chinese[gid][0]:
                        chinese[gid] = (key, name, "untagged" if is_untagged else lang.decode("ascii"))
    english = {int(g): v[1] for g, v in english.items()}
    chinese = {int(g): (v[1], v[2]) for g, v in chinese.items()}
    return english, chinese, date


def load_opencc(folder):
    """An OpenCC("t2s") converter from the package in folder. Exits with an error when it cannot be imported."""
    sys.path.insert(0, str(Path(folder).resolve()))
    try:
        from opencc import OpenCC
        return OpenCC("t2s")
    except Exception as e:
        sys.exit(f"error: cannot import OpenCC from {folder}: {e}")


def read_overrides(path):
    """{geonameid: Chinese name} from the overrides file; a malformed line is an error."""
    overrides = {}
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.rstrip("\r\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            cols = line.split("\t")
            name = _clean(cols[1]) if len(cols) > 1 else ""
            if not cols[0].isdigit() or not name or int(cols[0]) in overrides:
                raise ValueError(f"{path}: line {number} is not 'geonameid<tab>name' or repeats an id")
            overrides[int(cols[0])] = name
    return overrides


def build(source, out_path, converter, log=print, overrides=None):
    """converter: an object with convert(text), applied to every Chinese name (OpenCC t2s).
    overrides: {geonameid: Chinese name}; None reads OVERRIDES_FILE."""
    source = Path(source)
    if overrides is None:
        overrides = read_overrides(OVERRIDES_FILE)
    countries = read_countries(source / COUNTRY_FILE)
    admin1 = read_admin1(source / ADMIN1_FILE)
    city_rows, cities_date = read_cities(source / CITIES_ZIP)
    log(f"cities500: {len(city_rows)} kept rows ({sum(1 for r in city_rows if r[7])} sections), "
        f"{len(countries)} countries, {len(admin1)} admin1 entries")

    unknown_country = [r for r in city_rows if r[3] not in countries]
    if unknown_country:
        log(f"dropped {len(unknown_country)} places of countries missing from countryInfo: "
            f"{sorted({r[3] for r in unknown_country})}")
        city_rows = [r for r in city_rows if r[3] in countries]
    city_rows = [(r[0], r[1], r[2], r[3], r[4], "", r[6], True, 0) if r[3] in REGION_ONLY_COUNTRIES else r
                 for r in city_rows]
    used_regions = {f"{r[3]}.{r[4]}" for r in city_rows}
    named_regions = {code for code in used_regions if code in admin1}

    named_rows = [r for r in city_rows if not r[7]]
    wanted = {r[0] for r in named_rows}
    wanted.update(c[1] for c in countries.values())
    wanted.update(admin1[code][1] for code in named_regions)
    english, chinese, alt_date = scan_alternate_names(
        source / ALT_NAMES_ZIP, wanted, {r[0] for r in named_rows},
        untagged_ids={r[0] for r in named_rows if r[3] in UNTAGGED_ZH_COUNTRIES})

    converted = {}  # one converter call per distinct name
    changed = [0]   # Chinese names (as written to the file) the conversion changed

    used_overrides = set()

    def zh(gid):
        if gid in overrides:
            used_overrides.add(gid)
            return overrides[gid]
        if gid not in chinese:
            return ""
        name = chinese[gid][0]
        if name not in converted:
            converted[name] = converter.convert(name)
        if converted[name] != name:
            changed[0] += 1
        return converted[name]

    country_out = [(code, name, ZH_COUNTRY_NAMES.get(code) or zh(gid)) for code, (name, gid) in countries.items()]
    region_out = [(code, admin1[code][0], ZH_REGION_NAMES.get(code) or zh(admin1[code][1])) for code in named_regions]
    city_out = [(gid, lat, lon, f"{cc}.{adm}", "" if section else english.get(gid, name),
                 "" if section else zh(gid), population, section, level)
                for gid, lat, lon, cc, adm, name, population, section, level in city_rows]

    source_dates = f"cities500={cities_date};alternateNamesV2={alt_date}"
    count = places.write_places(out_path, country_out, region_out, city_out, source_dates=source_dates)

    def share(items):
        items = [x[-1] for x in items]  # the Chinese name is the last field of every row
        return f"{sum(1 for x in items if x)}/{len(items)}"
    log(f"wrote {count} places (+ {len(city_out) - count} sections), {len(country_out)} countries, "
        f"{len(used_regions)} regions "
        f"({len(used_regions) - len(named_regions)} without a name) to {out_path}")
    log(f"with a Chinese name: places {share([(x[5],) for x in city_out if not x[7]])}, "
        f"regions {share(region_out)}, countries {share(country_out)}")
    log(f"OpenCC t2s changed {changed[0]} of the Chinese names written ({len(converted)} distinct names converted)")
    unused = sorted(set(overrides) - used_overrides)
    log(f"overrides applied: {len(used_overrides)} of {len(overrides)}"
        + (f" (no such place, region or country: {unused})" if unused else ""))
    log("Chinese name languages used: " + ", ".join(f"{k}={v}" for k, v in sorted(
        Counter(v[1] for g, v in chinese.items() if g in wanted).items())))
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", required=True, help="folder with the four GeoNames files")
    parser.add_argument("--opencc", required=True, help="folder with the opencc package (pip --target)")
    parser.add_argument("--out", required=True, help="output file, normally api/place_data/places.npz")
    args = parser.parse_args(argv)
    converter = load_opencc(args.opencc)
    started = time.time()
    build(args.source, args.out, converter)
    print(f"done in {time.time() - started:.1f} s")


if __name__ == "__main__":
    main()
