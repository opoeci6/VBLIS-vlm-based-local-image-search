import os
from fastapi import HTTPException
import app_state
from media_image import is_skipped_dir
from security import is_within

_OUTSIDE = "Path is not inside an indexed folder"

# A viewer account without this permission sees no place names and can't filter by place (place ids
# would tell where photos were taken just as well). The desktop app's local owner may everything.
PLACES = "places"


def check_place_filters(auth, filters) -> None:
    if filters is not None and filters.places and not auth.may(PLACES):
        raise HTTPException(status_code=403, detail="The owner hasn't allowed place names for this account.")


def hide_places(auth, payload: dict, key: str = "results") -> dict:
    """The answer without the `place` of each item in payload[key], unless auth may see places. The
    items are made fresh for every request (Indexer._finish_results, expand_video), so they are changed
    in place."""
    if auth.may(PLACES):
        return payload
    for item in payload.get(key) or ():
        if isinstance(item, dict):
            item.pop("place", None)
    return payload


def hide_place_options(auth, options: dict) -> dict:
    if auth.may(PLACES):
        return options
    return {**options, "places_available": False, "places": [], "with_gps": 0}


def real_path_inside(path: str, roots) -> bool:
    """True when path, with every link resolved, lies in one of roots (also resolved)."""
    try:
        return is_within(os.path.realpath(path), [os.path.realpath(root) for root in roots if root])
    except (OSError, ValueError):
        return False


def passes_skipped_folder(path: str, roots, is_folder: bool = False) -> bool:
    """True when path lies below a folder that indexing never enters (on Linux: dot folders such as
    .cache or .Trash-1000, @eaDir, lost+found), counted from the indexed folder that holds it."""
    try:
        normalized = os.path.abspath(os.path.normpath(path))
        for root in roots:
            if not root or not is_within(normalized, [root]):
                continue
            relative = os.path.relpath(normalized, os.path.abspath(root))
            if relative == os.curdir:
                continue
            parts = relative.split(os.sep)
            if any(is_skipped_dir(part) for part in (parts if is_folder else parts[:-1])):
                return True
    except (OSError, ValueError):
        return True
    return False


def require_indexed_path(path: str, extensions=None, auth=None, is_folder: bool = False):
    """403 unless path is inside an indexed folder (and has an allowed extension, when given).
    Runs before any existence check so the API can't be used to probe files elsewhere. From the
    network the path must also stay inside once links are resolved, so a link placed in a shared
    folder can't serve a file from somewhere else, and must not pass through a folder that indexing
    skips (caches and trash folders hold copies of files from elsewhere)."""
    if not app_state.indexer.is_path_in_indexed_folders(path):
        raise HTTPException(status_code=403, detail=_OUTSIDE)
    if extensions is not None and os.path.splitext(path)[1].lower() not in extensions:
        raise HTTPException(status_code=403, detail="Unsupported file type")
    if auth is not None and auth.is_network:
        roots = app_state.indexer.folders.all_selected()
        if not real_path_inside(path, roots) or passes_skipped_folder(path, roots, is_folder):
            raise HTTPException(status_code=403, detail=_OUTSIDE)


def check_index_target(auth, path) -> str:
    """The canonical form of a folder a client wants indexed or re-synced. On the desktop any
    folder is accepted, as before: the person at this PC can read it anyway. From the network it
    must be absolute and lie in a library folder from the server settings, or in a folder that is
    already indexed, also once links are resolved."""
    if not isinstance(path, str) or not path.strip() or "\0" in path:
        raise HTTPException(status_code=400, detail="Invalid folder path.")
    if auth is None or not auth.is_network:
        return os.path.abspath(os.path.normpath(path))
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="The folder path must be absolute.")
    normalized = os.path.abspath(os.path.normpath(path))
    allowed = list(app_state.server_config.current().library_roots) + app_state.indexer.folders.all_selected()
    for root in allowed:
        if is_within(normalized, [root]) and real_path_inside(normalized, [root]):
            return normalized
    raise HTTPException(status_code=403, detail="This folder is outside the library folders set on the server.")


def payload_folders(payload) -> list:
    """The folder paths a task payload names (folder_paths and folder_path). A payload with
    folder entries of the wrong shape raises 400, so a check can't be skipped by mistake."""
    folders = []
    listed = payload.get("folder_paths")
    if listed is not None:
        if not isinstance(listed, list):
            raise HTTPException(status_code=400, detail="folder_paths must be a list of folder paths.")
        folders.extend(listed)
    single = payload.get("folder_path")
    if single is not None:
        folders.append(single)
    return folders
