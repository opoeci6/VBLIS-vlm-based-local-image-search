"""Search filters (media type, folder, date taken, orientation, format, size) that run in the backend before the
Max Results cut, and the options the filter panel offers. The filter is answered from a file's path alone
(media type, format, folder) or from the media registry's per-file facts (date, orientation, megapixels)."""
import datetime
import os
from typing import Annotated, Callable, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from media_registry import MediaRegistry

# format id -> (label, media type, extensions). Keep in step with media_image.IMAGE_EXTENSIONS and
# media_video.VIDEO_EXTENSIONS (a test pins that).
FORMAT_GROUPS = {
    "jpeg": ("JPEG", "image", (".jpg", ".jpeg")),
    "png": ("PNG", "image", (".png",)),
    "webp": ("WebP", "image", (".webp",)),
    "bmp": ("BMP", "image", (".bmp",)),
    "heic": ("HEIC", "image", (".heic", ".heif")),
    "avif": ("AVIF", "image", (".avif",)),
    "mp4": ("MP4", "video", (".mp4",)),
    "m4v": ("M4V", "video", (".m4v",)),
    "mov": ("MOV", "video", (".mov",)),
    "mkv": ("MKV", "video", (".mkv",)),
    "avi": ("AVI", "video", (".avi",)),
    "webm": ("WebM", "video", (".webm",)),
}
FORMAT_BY_EXTENSION = {ext: format_id for format_id, (_, _, exts) in FORMAT_GROUPS.items() for ext in exts}

MAX_FOLDERS = 500
MAX_FOLDER_LENGTH = 4096
MAX_MEGAPIXELS = 1000
SQUARE_TOLERANCE = 0.01  # |w - h| <= 1% of the longer side counts as square

FormatId = Literal[tuple(FORMAT_GROUPS)]  # one Literal of every format id, so the two can't drift
Orientation = Literal["landscape", "portrait", "square"]
DuplicateKind = Literal["exact", "visual"]
FolderPath = Annotated[str, StringConstraints(min_length=1, max_length=MAX_FOLDER_LENGTH)]


def _unique(values):
    return list(dict.fromkeys(values))


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_type: Optional[Literal["image", "video"]] = None
    folders: list[FolderPath] = Field(default_factory=list, max_length=MAX_FOLDERS)
    date_from: Optional[datetime.date] = None
    date_to: Optional[datetime.date] = None
    orientations: list[Orientation] = Field(default_factory=list)
    formats: list[FormatId] = Field(default_factory=list)
    min_megapixels: Optional[float] = Field(None, gt=0, le=MAX_MEGAPIXELS)
    # Images that have an exact copy ("exact") and/or a visually similar image ("visual") elsewhere in the library
    # (an item passes when any chosen kind applies); empty is no filter
    duplicates: list[DuplicateKind] = Field(default_factory=list)

    @field_validator("orientations", "formats", "duplicates")
    @classmethod
    def _dedupe(cls, values):
        return _unique(values)

    @model_validator(mode="after")
    def _date_range_is_ordered(self):
        if self.date_from is not None and self.date_to is not None and self.date_from > self.date_to:
            raise ValueError("date_from must not be after date_to")
        return self

    @property
    def needs_facts(self) -> bool:
        """True when the media registry's per-file facts are needed to answer the filter."""
        return (self.date_from is not None or self.date_to is not None or bool(self.orientations)
                or self.min_megapixels is not None)

    @property
    def is_active(self) -> bool:
        return (self.media_type is not None or bool(self.folders) or bool(self.formats) or bool(self.duplicates)
                or self.needs_facts)


def compile_filters(filters: Optional[SearchFilters], snapshot_fn: Callable,
                    duplicates_fn: Optional[Callable] = None) -> Optional["RecordFilter"]:
    """The RecordFilter of one search; None when there is nothing to filter. The registry snapshot is read
    once, and only when the filter needs per-file facts. `duplicates_fn()` is called once, and only when the
    filter asks for duplicates; it returns the predicate (path) -> bool that says whether an image has an
    existing exact copy / visual look-alike (the indexer builds it for the search)."""
    if filters is None or not filters.is_active:
        return None
    facts = snapshot_fn().facts if filters.needs_facts else None
    duplicates = duplicates_fn() if filters.duplicates and duplicates_fn is not None else None
    return RecordFilter(filters, facts, duplicates)


class RecordFilter:
    """Answers allows_path(path, is_video) for the files of one search (the instance lives for one search:
    answers are memoized and the facts are a snapshot). Checks run cheapest first."""

    def __init__(self, filters: SearchFilters, facts: Optional[Mapping] = None,
                 duplicates: Optional[Callable[[str], bool]] = None):
        if filters.duplicates and duplicates is None:
            raise ValueError("A duplicates filter needs the duplicates predicate")
        self._duplicates = duplicates if filters.duplicates else None
        self._media_type = filters.media_type
        self._extensions = None
        if filters.formats:
            self._extensions = frozenset(ext for format_id in filters.formats for ext in FORMAT_GROUPS[format_id][2])
        self._roots = tuple(MediaRegistry.key_for(folder).rstrip(os.sep) for folder in filters.folders)
        self._date_from = filters.date_from.isoformat() if filters.date_from else None
        self._date_to = filters.date_to.isoformat() if filters.date_to else None
        self._orientations = frozenset(filters.orientations)
        self._min_pixels = filters.min_megapixels * 1_000_000 if filters.min_megapixels is not None else None
        self._needs_facts = filters.needs_facts
        self._facts = facts if facts is not None else {}
        self._keys = {}     # path -> registry key, computed once per path
        self._answers = {}  # (path, is_video) -> bool

    def allows_path(self, path: str, is_video: bool) -> bool:
        answer_key = (path, is_video)
        answer = self._answers.get(answer_key)
        if answer is None:
            key = self._keys.get(path)
            if key is None:
                key = self._keys[path] = MediaRegistry.key_for(path)
            answer = self._allows(key, is_video)
            if answer and self._duplicates is not None:
                # The most expensive check, so last; only an image can pass (see _allows)
                answer = bool(self._duplicates(path))
            self._answers[answer_key] = answer
        return answer

    def _allows(self, key: str, is_video: bool) -> bool:
        if self._duplicates is not None and is_video:
            return False
        if self._media_type is not None and (self._media_type == "video") != is_video:
            return False
        if self._extensions is not None and os.path.splitext(key)[1].lower() not in self._extensions:
            return False
        if self._roots and not any(key == root or key.startswith(root + os.sep) for root in self._roots):
            return False
        if not self._needs_facts:
            return True
        facts = self._facts.get(key)
        if facts is None:
            return False
        if self._date_from is not None or self._date_to is not None:
            if not facts.taken_at:
                return False
            day = facts.taken_at[:10]
            if self._date_from is not None and day < self._date_from:
                return False
            if self._date_to is not None and day > self._date_to:
                return False
        if self._orientations or self._min_pixels is not None:
            width, height = facts.width, facts.height
            if width is None or height is None:
                return False
            if self._orientations and _orientation_of(width, height) not in self._orientations:
                return False
            if self._min_pixels is not None and width * height < self._min_pixels:
                return False
        return True


def _orientation_of(width: int, height: int) -> str:
    if abs(width - height) <= SQUARE_TOLERANCE * max(width, height):
        return "square"
    return "landscape" if width > height else "portrait"


def empty_filter_options(registry_available: bool) -> dict:
    return {
        "total_files": 0, "with_details": 0, "unavailable": 0, "missing_details": 0,
        "media_types": {"image": 0, "video": 0}, "formats": [], "years": [], "date_range": None,
        "registry_available": registry_available,
        "duplicates": {"exact": 0, "visual": None},
    }


def filter_options(scan: Mapping, snapshot, selected_roots, registry_available: bool,
                   duplicates: Optional[Mapping] = None) -> dict:
    """What the filter panel offers: the distinct files of the collection (`scan` is a full
    `collection.get(include=["metadatas"])`) counted by media type, format and year taken. `unavailable`
    counts files under a selected folder that can't be reached right now (an unplugged drive);
    `missing_details` counts the other files that have no media details yet, which reading the details
    (the media scan) can fill in. `duplicates` is the indexer's {"exact": n, "visual": n or None} (the image
    files that have an existing exact copy / visual partner; None while no visual index exists)."""
    facts = snapshot.facts
    roots = []  # (root key, root path, is a directory right now; None until asked)
    for root in selected_roots:
        roots.append([MediaRegistry.key_for(root).rstrip(os.sep), root, None])

    seen = set()
    media_types = {"image": 0, "video": 0}
    format_counts = {}
    year_counts = {}
    with_details = 0
    unavailable = 0
    missing_details = 0
    first_day = last_day = None
    for meta in scan.get("metadatas") or []:
        path = meta.get("path") if meta else None
        if not path:
            continue
        key = MediaRegistry.key_for(path)
        if key in seen:
            continue
        seen.add(key)
        media_types["video" if meta.get("media_type", "image") == "video" else "image"] += 1
        format_id = FORMAT_BY_EXTENSION.get(os.path.splitext(key)[1].lower())
        if format_id is not None:
            format_counts[format_id] = format_counts.get(format_id, 0) + 1
        row = facts.get(key)
        if row is not None:
            with_details += 1
            if row.taken_at:
                day = row.taken_at[:10]
                if first_day is None or day < first_day:
                    first_day = day
                if last_day is None or day > last_day:
                    last_day = day
                year = row.taken_at[:4]
                if year.isdigit():
                    year_counts[int(year)] = year_counts.get(int(year), 0) + 1
        is_unavailable = False
        for entry in roots:
            if key == entry[0] or key.startswith(entry[0] + os.sep):
                if entry[2] is None:
                    entry[2] = os.path.isdir(entry[1])
                if not entry[2]:
                    is_unavailable = True
                    break
        if is_unavailable:
            unavailable += 1
        elif row is None:
            missing_details += 1

    return {
        "total_files": len(seen),
        "with_details": with_details,
        "unavailable": unavailable,
        "missing_details": missing_details,
        "media_types": media_types,
        "formats": [
            {"id": format_id, "label": label, "media_type": media_type, "count": format_counts[format_id]}
            for format_id, (label, media_type, _) in FORMAT_GROUPS.items() if format_id in format_counts
        ],
        "years": [{"year": year, "count": year_counts[year]} for year in sorted(year_counts, reverse=True)],
        "date_range": {"from": first_day, "to": last_day} if first_day is not None else None,
        "registry_available": registry_available,
        "duplicates": dict(duplicates) if duplicates is not None else {"exact": 0, "visual": None},
    }
