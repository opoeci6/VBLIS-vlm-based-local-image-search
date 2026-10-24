"""Thumbnail cache files that never show up half-written.

Exact-duplicate images share one content-hash cache file, and the UI requests both thumbnails at
the same instant. Generation is therefore serialized per cache file, and each file is written to a
temp file and moved into place with os.replace(), so readers see either no file or a finished one.
"""
import os
import pathlib
import tempfile
import threading
from contextlib import contextmanager

THUMBNAIL_SIZE = (480, 480)
THUMBNAIL_JPEG_QUALITY = 78
# Temp files are named "<cache file name>.<random>.tmp"
TEMP_FILE_GLOB = "*.jpg.*.tmp"

_key_locks = {}  # normalized cache path -> [lock, number of threads holding or waiting for it]
_key_locks_guard = threading.Lock()


@contextmanager
def _locked(cache_path):
    key = os.path.normcase(os.path.abspath(cache_path))
    with _key_locks_guard:
        entry = _key_locks.setdefault(key, [threading.Lock(), 0])
        entry[1] += 1
    try:
        with entry[0]:
            yield
    finally:
        with _key_locks_guard:
            entry[1] -= 1
            if entry[1] == 0:
                del _key_locks[key]


def is_thumbnail_cached(path) -> bool:
    """True if path is a usable cache file. Zero-byte files left by older versions don't count."""
    try:
        return os.path.getsize(path) > 0
    except OSError:
        return False


def save_jpeg_thumbnail(img, fp):
    """Shrink img in place to fit 480x480 and write it to fp in the cache's JPEG format."""
    img.thumbnail(THUMBNAIL_SIZE)
    img.convert("RGB").save(fp, format="JPEG", quality=THUMBNAIL_JPEG_QUALITY, optimize=True)


def get_or_create_thumbnail(cache_path, render, legacy_path=None) -> pathlib.Path:
    """Return the path of a complete cache file for cache_path, calling render(fp) to write it if needed.

    Concurrent callers for the same cache_path wait for a single render and then share its result.
    A complete file at legacy_path is moved into place instead of rendering; if that move fails,
    legacy_path is returned. Exceptions from render propagate and leave no file behind.
    """
    cache_path = pathlib.Path(cache_path)
    if is_thumbnail_cached(cache_path):
        return cache_path

    with _locked(cache_path):
        # Another thread may have finished it while we waited
        if is_thumbnail_cached(cache_path):
            return cache_path

        if legacy_path is not None and is_thumbnail_cached(legacy_path):
            try:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                os.replace(legacy_path, cache_path)
                return cache_path
            except OSError:
                return pathlib.Path(legacy_path)

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=cache_path.parent, prefix=cache_path.name + ".", suffix=".tmp")
        tmp_path = pathlib.Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as fp:
                render(fp)
            if not is_thumbnail_cached(tmp_path):
                raise ValueError(f"Thumbnail render wrote no data for {cache_path.name}")
            try:
                os.replace(tmp_path, cache_path)
            except OSError:
                # Windows refuses to replace a file someone holds open, e.g. when another process
                # published this thumbnail meanwhile and is serving it. Serve that copy then.
                if not is_thumbnail_cached(cache_path):
                    raise
        finally:
            tmp_path.unlink(missing_ok=True)
        return cache_path
