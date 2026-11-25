"""The browser's folder picker: lists folders under the library folders from the server settings.
Only the network app includes this router, and only the owner may use it."""
import os
import stat
import sys

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

import app_state
import local_places
from auth_context import Auth, NetRequest, current_auth, net_request
from media_image import is_skipped_dir
from routers.guards import real_path_inside
from security import is_within

router = APIRouter()

MAX_LISTED = 5000
_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def _is_link(entry) -> bool:
    """A symbolic link, or on Windows also a junction (a reparse point)."""
    try:
        if entry.is_symlink():
            return True
        if os.name == "nt":
            return bool(entry.stat(follow_symlinks=False).st_file_attributes & _REPARSE_POINT)
    except OSError:
        return True
    return False


def _root_for(path: str, roots):
    for root in roots:
        if is_within(path, [root]) and real_path_inside(path, [root]):
            return root
    return None


def _local_root_for(path: str, library_roots) -> str:
    candidates = [place["path"] for place in local_places.computer_places(library_roots)]
    candidates.extend(root for root in library_roots if root)
    matching = [candidate for candidate in candidates if is_within(path, [candidate])]
    if matching:
        return max(matching, key=lambda candidate: len(os.path.normpath(os.path.abspath(candidate))))
    drive, _ = os.path.splitdrive(path)
    return (drive + os.sep) if drive else os.sep


def _permission_denied() -> JSONResponse:
    if sys.platform == "darwin":
        return JSONResponse(
            {
                "detail": (
                    "The server isn't allowed to read this folder. "
                    "macOS asks before Terminal may read Desktop, Documents, Downloads or a removable drive: "
                    "click Allow, or allow Terminal in System Settings → Privacy & Security → Files and Folders."
                ),
                "code": "macos_privacy",
            },
            status_code=403,
        )
    return JSONResponse({"detail": "The server isn't allowed to read this folder.", "code": "no_permission"}, status_code=403)


@router.get("/fs/roots")
def list_roots(net: NetRequest = Depends(net_request), auth: Auth = Depends(current_auth)):
    library_roots = net.store.current().library_roots
    if auth.on_this_computer:
        return {"local": True, "roots": local_places.computer_places(library_roots)}
    return {
        "local": False,
        "roots": [
            {
                "path": root,
                "name": os.path.basename(root.rstrip(os.sep)) or root,
                "kind": "library",
                "available": os.path.isdir(root),
            }
            for root in library_roots
        ],
    }


@router.get("/fs/list")
def list_folder(
    path: str = Query(..., max_length=4096),
    net: NetRequest = Depends(net_request),
    auth: Auth = Depends(current_auth),
):
    if "\0" in path or not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="The folder path must be absolute.")
    normalized = os.path.abspath(os.path.normpath(path))
    library_roots = net.store.current().library_roots
    if auth.on_this_computer:
        root = _local_root_for(normalized, library_roots)
    else:
        root = _root_for(normalized, library_roots)
        if root is None:
            raise HTTPException(status_code=403, detail="This folder is outside the library folders set on the server.")
    if not os.path.isdir(normalized):
        raise HTTPException(status_code=404, detail="Folder not found.")

    indexed = app_state.indexer.folders.all_selected()
    folders, skipped, truncated = [], 0, False
    try:
        with os.scandir(normalized) as entries:
            for entry in entries:
                try:
                    if not entry.is_dir():
                        continue
                except OSError:
                    continue
                if is_skipped_dir(entry.name):
                    continue
                try:
                    entry.name.encode("utf-8")
                except UnicodeEncodeError:
                    skipped += 1  # a Linux name that isn't valid UTF-8 can't travel as JSON
                    continue
                if not auth.on_this_computer and _is_link(entry) and not real_path_inside(entry.path, [root]):
                    continue
                folders.append({
                    "name": entry.name,
                    "path": entry.path,
                    "indexed": is_within(entry.path, indexed),
                })
                if len(folders) >= MAX_LISTED:
                    truncated = True
                    break
    except PermissionError:
        return _permission_denied()
    except OSError:
        raise HTTPException(status_code=404, detail="Folder not found.")

    folders.sort(key=lambda item: (item["name"].casefold(), item["name"]))
    at_root = is_within(normalized, [root]) and is_within(root, [normalized])
    return {
        "path": normalized,
        "root": root,
        "parent": None if at_root else os.path.dirname(normalized),
        "indexed": is_within(normalized, indexed),
        "folders": folders,
        "skipped": skipped,
        "truncated": truncated,
    }
