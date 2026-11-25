"""Places shown in the folder picker when the server serves an owner on this computer:
home folder, connected drives / volumes, the filesystem root (POSIX), and any remaining library folders."""
import getpass
import os
import sys

import path_keys

MAX_VOLUMES = 50
MACOS_VOLUMES_DIR = "/Volumes"
LINUX_MEDIA_DIR = "/media"
LINUX_RUN_MEDIA_DIR = "/run/media"
LINUX_MNT_DIR = "/mnt"


def _home_dir() -> str:
    return os.path.expanduser("~")


def _windows_drives() -> list:
    import ctypes

    mask = ctypes.windll.kernel32.GetLogicalDrives()
    drives = []
    for i in range(26):
        if mask & (1 << i):
            letter = chr(ord("A") + i)
            drives.append((f"{letter}:\\", f"{letter}:"))
    return drives


def _scan_subdirs(base_dir: str, skip_names=()) -> list:
    """Return [(path, name), ...] for non-dot, non-symlink subdirectories of base_dir."""
    found = []
    try:
        with os.scandir(base_dir) as entries:
            for entry in entries:
                if entry.name.startswith(".") or entry.name in skip_names:
                    continue
                try:
                    if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                found.append((entry.path, entry.name))
    except OSError:
        return []
    return found


def _volume_candidates() -> list:
    if sys.platform == "darwin":
        return _scan_subdirs(MACOS_VOLUMES_DIR)
    if sys.platform.startswith("linux"):
        try:
            user = getpass.getuser() or None
        except Exception:
            user = None
        found = []
        if user:
            found.extend(_scan_subdirs(os.path.join(LINUX_MEDIA_DIR, user)))
            found.extend(_scan_subdirs(os.path.join(LINUX_RUN_MEDIA_DIR, user)))
        found.extend(_scan_subdirs(LINUX_MNT_DIR))
        found.extend(_scan_subdirs(LINUX_MEDIA_DIR, skip_names=(user,) if user else ()))
        return found
    if sys.platform == "win32":
        return _windows_drives()
    return []


def computer_places(library_roots=()) -> list:
    """Ordered places on this computer: home, connected volumes (up to 50), '/' (POSIX), and
    remaining library folders, deduplicated by path_keys.fold(os.path.normpath(path))."""
    places = []
    seen = set()

    def add(path: str, name: str, kind: str, available: bool) -> None:
        key = path_keys.fold(os.path.normpath(path))
        if key in seen:
            return
        seen.add(key)
        places.append({"path": path, "name": name, "kind": kind, "available": available})

    raw_home = _home_dir()
    if raw_home:
        home = os.path.normpath(raw_home)
        if os.path.isabs(home) and os.path.dirname(home) != home and os.path.isdir(home):
            add(home, os.path.basename(home) or home, "home", True)

    volumes = []
    vol_seen = set(seen)
    for path, name in _volume_candidates():
        key = path_keys.fold(os.path.normpath(path))
        if key in vol_seen:
            continue
        vol_seen.add(key)
        volumes.append((path, name))
    volumes.sort(key=lambda item: (item[1].casefold(), item[1], item[0]))
    for path, name in volumes[:MAX_VOLUMES]:
        add(path, name, "volume", os.path.isdir(path))

    if sys.platform == "darwin" or sys.platform.startswith("linux"):
        add("/", "/", "disk", os.path.isdir("/"))

    for root in library_roots:
        if not root:
            continue
        add(root, os.path.basename(root.rstrip(os.sep)) or root, "library", os.path.isdir(root))

    return places
