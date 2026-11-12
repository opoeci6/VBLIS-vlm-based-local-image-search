"""Keeps the media registry in step with the media files on disk: probes the files that are new or changed
since their row was written, and drops the rows of files that are gone. A file whose size and modified time
match its row is never opened again, so a run over unchanged files is one SQL read."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import NamedTuple

from PIL import UnidentifiedImageError

from media_image import _format_offset, _format_taken, is_macos_junk_path, probe_image_info
from media_video import probe_video_info

# Bump when the probers change. What each version changed, and so which rows are read again:
#   2: the size and orientation of a HEIC / HEIF file whose container already turns it (irot / imir) no
#      longer count its EXIF orientation too. Only .heic / .heif rows can be wrong, see _row_is_current.
PROBE_VERSION = 2
_HEIF_EXTENSIONS = (".heic", ".heif")


def _row_is_current(path, probe_version) -> bool:
    """True when a row probed under `probe_version` needs no new read (the file itself unchanged)."""
    if probe_version >= PROBE_VERSION:
        return True
    return probe_version == 1 and not path.lower().endswith(_HEIF_EXTENSIONS)


SYNC_CHUNK = 500
_ERROR_LIMIT = 300
_PROBE_FIELDS = (
    "width", "height", "orientation", "rotation", "duration_s",
    "taken_at", "taken_offset", "gps_lat", "gps_lon", "gps_alt",
)


class SyncResult(NamedTuple):
    probed: int
    unchanged: int
    pruned: int
    errors: int
    seconds: float
    stopped: bool
    skipped: int  # files that vanished, or failed to read for a reason that may pass (no row written)


def _mtime_date(mtime_ns):
    """(taken_at, taken_offset) of a file's modified time as local wall time, or (None, None) when the
    time is outside what the platform can convert."""
    try:
        moment = datetime.fromtimestamp(mtime_ns / 1e9)
        return _format_taken(moment), _format_offset(moment.astimezone().utcoffset())
    except (OverflowError, OSError, ValueError):
        return None, None


def _is_transient(path, error, stat) -> bool:
    """True when a probe failure may pass: the file is gone or changed meanwhile, or the failure is an I/O
    error (unplugged drive, locked file) rather than a file that cannot be decoded."""
    try:
        st = os.stat(path)
    except OSError:
        return True
    if (st.st_mtime_ns, st.st_size) != tuple(stat):
        return True
    return isinstance(error, OSError) and not isinstance(error, UnidentifiedImageError)


def _probe_row(path, media_type, stat):
    """The registry row of one file, or None when no row should be written: the file is gone or the read
    failed in a way that may pass, so an existing row stays and the next sync tries again. A file that
    cannot be decoded gives a row with `error` set, so it is not read again until it changes."""
    if stat is None:
        try:
            st = os.stat(path)
        except OSError:
            return None
        mtime_ns, size = st.st_mtime_ns, st.st_size
    else:
        mtime_ns, size = stat
    row = {
        "path": path, "media_type": media_type, "ext": os.path.splitext(path)[1].lower(),
        "size": size, "mtime_ns": mtime_ns, "probe_version": PROBE_VERSION, "error": None,
    }
    row.update(dict.fromkeys(_PROBE_FIELDS))
    try:
        info = probe_image_info(path) if media_type == "image" else probe_video_info(path)
        row.update({field: info.get(field) for field in _PROBE_FIELDS})
    except Exception as e:
        if _is_transient(path, e, (mtime_ns, size)):
            return None
        row["error"] = f"{type(e).__name__}: {e}"[:_ERROR_LIMIT]
    if row["taken_at"]:
        row["taken_source"] = "exif" if media_type == "image" else "video"
    else:
        row["taken_at"], row["taken_offset"] = _mtime_date(mtime_ns)
        row["taken_source"] = "mtime" if row["taken_at"] else None
    return row


def sync_media_files(registry, files, roots, should_stop=None, on_progress=None, max_workers=16) -> SyncResult:
    """Probe the files whose row is missing or out of date and write the rows, then delete the rows of
    files that are gone from under `roots`.

    files: iterable of (path, media_type, stat); media_type is "image" or "video" and stat is
    (mtime_ns, size), or None when it is not known (it is read before probing).
    should_stop() is asked once before the first chunk and after each chunk (it may block while the task
    is paused); when it returns True the sync stops without pruning. on_progress(done, total) is called
    after each chunk."""
    started = time.monotonic()
    if not registry.available:
        return SyncResult(0, 0, 0, 0, time.monotonic() - started, False, 0)

    unique = {}
    for path, media_type, stat in files:
        unique.setdefault(registry.key_for(path), (path, media_type, stat))

    known = registry.stat_index()
    to_probe = []
    unchanged = 0
    for key, (path, media_type, stat) in unique.items():
        row = known.get(key)
        if row is not None and stat is not None and row[1] == stat[1] and row[2] == stat[0] and _row_is_current(path, row[3]):
            unchanged += 1
        else:
            to_probe.append((path, media_type, stat))

    total = len(to_probe)
    probed = errors = skipped = done = 0
    stopped = bool(should_stop and should_stop())
    if not stopped and to_probe:
        with ThreadPoolExecutor(max_workers=max(1, min(max_workers, total))) as pool:
            for start in range(0, total, SYNC_CHUNK):
                chunk = to_probe[start:start + SYNC_CHUNK]
                rows = [row for row in pool.map(lambda entry: _probe_row(*entry), chunk) if row]
                probed += registry.upsert(rows)
                errors += sum(1 for row in rows if row["error"])
                skipped += len(chunk) - len(rows)
                done += len(chunk)
                if on_progress:
                    on_progress(done, total)
                if should_stop and should_stop():
                    stopped = True
                    break

    pruned = 0 if stopped else _prune(registry, known, unique, roots)
    return SyncResult(probed, unchanged, pruned, errors, time.monotonic() - started, stopped, skipped)


def _prune(registry, known, unique, roots) -> int:
    """Delete the rows under a root that is a directory right now, whose file was not discovered and either
    no longer exists or is macOS metadata that discovery skips (rows written before it did). A root that is
    not a directory (unplugged drive, deleted folder) prunes nothing."""
    live_roots = [root for root in roots if root and os.path.isdir(root)]
    if not live_roots:
        return 0
    # Stored keys are normcase(abspath), so comparing them with the root keys matches security.is_within
    root_keys = [registry.key_for(root).rstrip(os.sep) for root in live_roots]
    gone = [
        key for key, row in known.items()
        if key not in unique
        and any(key == root_key or key.startswith(root_key + os.sep) for root_key in root_keys)
        and (is_macos_junk_path(row[0]) or not os.path.exists(row[0]))
    ]
    return registry.delete(gone) if gone else 0
