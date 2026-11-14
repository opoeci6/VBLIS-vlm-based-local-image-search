"""The browser's folder picker: lists folders under the library folders from the server settings.
Only the network app includes this router, and only the owner may use it."""
import os
import stat

from fastapi import APIRouter, Depends, HTTPException, Query

import app_state
from auth_context import NetRequest, net_request
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


@router.get("/fs/roots")
def list_roots(net: NetRequest = Depends(net_request)):
    roots = net.store.current().library_roots
    return {
        "roots": [
            {"path": root, "name": os.path.basename(root.rstrip(os.sep)) or root, "available": os.path.isdir(root)}
            for root in roots
        ]
    }


@router.get("/fs/list")
def list_folder(path: str = Query(..., max_length=4096), net: NetRequest = Depends(net_request)):
    if "\0" in path or not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="The folder path must be absolute.")
    normalized = os.path.abspath(os.path.normpath(path))
    root = _root_for(normalized, net.store.current().library_roots)
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
                if _is_link(entry) and not real_path_inside(entry.path, [root]):
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
        raise HTTPException(status_code=403, detail="The server can't read this folder.")
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
