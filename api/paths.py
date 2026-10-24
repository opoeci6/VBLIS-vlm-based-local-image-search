"""Central definition of every on-disk location used by the backend.

By default all data lives next to this file (the api folder). Set the
VBLIS_DATA_DIR environment variable to relocate it (packaged builds, tests).
"""
import errno
import os
import shutil
import sys
import time
from contextlib import contextmanager
from pathlib import Path

API_DIR = Path(__file__).parent.resolve()

_data_dir_env = os.environ.get("VBLIS_DATA_DIR")
DATA_ROOT = Path(_data_dir_env).resolve() if _data_dir_env else API_DIR

MODELS_DIR = DATA_ROOT / "models"  # used as HF_HOME
HUB_DIR = MODELS_DIR / "hub"
CACHE_DIR = DATA_ROOT / "cache"
IMAGE_CACHE_DIR = CACHE_DIR / "images"
VIDEO_CACHE_DIR = CACHE_DIR / "videos"
DATA_DIR = DATA_ROOT / "data"
CHROMA_DIR = DATA_ROOT / "chroma_data"
ENV_FILE = DATA_ROOT / ".env"

# Everything packaged builds used to keep inside the install folder
LEGACY_DATA_ITEMS = ("models", "chroma_data", "cache", "data", ".env")
_STAGING_SUFFIX = ".migrating"
_LOCK_FILE_NAME = ".migration.lock"


class MigrationLockedError(RuntimeError):
    """Another backend process is migrating the same data folder right now."""


def ensure_dirs():
    """Create the data folders that must exist before the backend starts."""
    for directory in (DATA_ROOT, CACHE_DIR, IMAGE_CACHE_DIR, VIDEO_CACHE_DIR, DATA_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def migrate_legacy_data(legacy_root=None, data_root=None, frozen=None, retry_delay=1.0):
    """Move data that a packaged build stored next to its bundled code into DATA_ROOT.

    Before VBLIS_DATA_DIR existed, frozen builds kept models, the index, caches and .env
    inside the install folder (API_DIR), where installer updates and uninstalls can delete
    them. Each item moves at most once and nothing is ever overwritten: an item already
    present in data_root is left alone (an empty folder counts as absent). Runs under a
    cross-process lock and must run before anything opens those files.

    Returns {item: "moved" | "kept_existing" | "failed"} for the legacy items found. On
    "failed" the caller must not start: fresh state created next to half-migrated data
    would shadow the old copy forever. Raises MigrationLockedError if another process holds
    the lock.
    """
    legacy_root = Path(legacy_root) if legacy_root is not None else API_DIR
    data_root = Path(data_root) if data_root is not None else DATA_ROOT
    if frozen is None:
        frozen = bool(getattr(sys, "frozen", False))
    if not frozen or legacy_root.resolve() == data_root.resolve():
        return {}

    data_root.mkdir(parents=True, exist_ok=True)
    report = {}
    with _exclusive_lock(data_root / _LOCK_FILE_NAME):
        for name in LEGACY_DATA_ITEMS:
            src = legacy_root / name
            dst = data_root / name
            staging = data_root / (name + _STAGING_SUFFIX)
            # Leftover from an interrupted cross-volume copy (the source is still intact).
            # Only safe to delete while holding the lock.
            _remove(staging)
            if not src.exists():
                continue
            if _is_empty_dir(dst):
                dst.rmdir()
            if dst.exists():
                report[name] = "kept_existing"
                _log(f"{dst} already exists; left the old copy at {src}")
                continue
            try:
                _move_item(src, dst, staging, retry_delay)
                report[name] = "moved"
                _log(f"Moved {src} -> {dst}")
            except Exception as e:
                _remove(staging)
                report[name] = "failed"
                _log(f"Could not move {src} -> {dst}: {e}")
    return report


def _move_item(src, dst, staging, retry_delay):
    try:
        _replace_with_retry(src, dst, retry_delay)
        return
    except OSError as e:
        if not _is_cross_device(e):
            raise
    # Different drive (e.g. a custom install folder): copy under a staging name first so an
    # interruption never leaves a half-copied item as dst, and check it before deleting src
    if src.is_dir():
        shutil.copytree(src, staging, symlinks=True)
    else:
        shutil.copy2(src, staging, follow_symlinks=False)
    if _tree_stats(staging) != _tree_stats(src):
        raise OSError(f"copy of {src} is incomplete")
    _replace_with_retry(staging, dst, retry_delay)
    _remove(src)


def _replace_with_retry(src, dst, retry_delay, attempts=5):
    """os.replace, retrying briefly when a file inside is held open (antivirus, Explorer)."""
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except OSError as e:
            if _is_cross_device(e) or attempt == attempts - 1:
                raise
            time.sleep(retry_delay)


def _is_cross_device(error):
    # WinError 17: "The system cannot move the file to a different disk drive"
    return getattr(error, "winerror", None) == 17 or error.errno == errno.EXDEV


def _is_empty_dir(path):
    return path.is_dir() and not path.is_symlink() and not any(path.iterdir())


def _tree_stats(path):
    """(file count, total bytes) of a file or folder, without following symlinks."""
    if not path.is_dir() or path.is_symlink():
        return 1, os.lstat(path).st_size
    count = size = 0
    for root, _dirs, files in os.walk(path):
        for file_name in files:
            count += 1
            size += os.lstat(os.path.join(root, file_name)).st_size
    return count, size


@contextmanager
def _exclusive_lock(lock_path):
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT)
    try:
        try:
            _lock_fd(fd)
        except OSError as e:
            raise MigrationLockedError(f"Another VBLIS backend is migrating data in {lock_path.parent}") from e
        try:
            yield
        finally:
            _unlock_fd(fd)
    finally:
        os.close(fd)


def _lock_fd(fd):
    if os.name == "nt":
        import msvcrt
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_fd(fd):
    if os.name == "nt":
        import msvcrt
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_UN)


def _log(message):
    line = f"[DataMigration] {message}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        # stdout is a pipe using the ANSI code page; never let a non-ASCII path stop startup
        print(line.encode("ascii", "backslashreplace").decode("ascii"), flush=True)


def _remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists() or path.is_symlink():
        try:
            path.unlink()
        except OSError:
            pass
