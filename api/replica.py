"""Read-only mode of a replica: a data folder whose index was imported from another machine (index_import).

The marker data/replica.json is read once, when the backend starts: it only changes through the
import-index and detach-replica commands, which need the data-folder lock, so never while this backend runs.

Read-only means the index, the media details and the folder list are never written here: indexing happens
on the machine the export came from, and the next import replaces everything. Writes are refused at three
levels: a route dependency (require_writable) on the routes that only write the index, the task queue for the
task types that index (so every way of queuing them is covered), and the folder list, which keeps its
changes in memory. Caches, accounts, sharing and GPU settings are this machine's own and stay writable."""
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse

import paths

READ_ONLY_CODE = "read_only"

# Task types that write the index or the media details
BLOCKED_TASK_TYPES = frozenset({"INDEX_FOLDERS", "REINDEX_FOLDER", "BATCH_REINDEX", "SCAN_MEDIA_INFO", "PRUNE_DELETED"})


class ReadOnlyError(Exception):
    """A write that a replica refuses. Answered with 409 {"detail", "code": "read_only"}."""

    def __init__(self, what="This"):
        super().__init__(f"{what} isn't possible here: this library is a read-only copy of an index made on "
                         f"{source_host() or 'another computer'}. Index there, then export and import again.")


_marker: Optional[dict] = None
_loaded = False


def load(data_dir=None) -> Optional[dict]:
    """Reads the marker of `data_dir` (default: this backend's data folder) and keeps it for the process."""
    global _marker, _loaded
    from index_import import read_replica

    _marker = read_replica(str(data_dir if data_dir is not None else paths.DATA_DIR))
    _loaded = True
    return _marker


def marker() -> Optional[dict]:
    if not _loaded:
        load()
    return _marker


def is_read_only() -> bool:
    return marker() is not None


def source_host() -> str:
    value = (marker() or {}).get("source") or {}
    return str(value.get("host") or "") if isinstance(value, dict) else ""


def summary() -> Optional[dict]:
    """What the interface shows about a replica (owners only), or None for an ordinary index."""
    value = marker()
    if value is None:
        return None
    counts = value.get("counts") if isinstance(value.get("counts"), dict) else {}
    return {
        "source_host": source_host(),
        "exported_at": value.get("exported_at") if isinstance(value.get("exported_at"), str) else None,
        "imported_at": value.get("imported_at") if isinstance(value.get("imported_at"), str) else None,
        "model_id": value.get("model_id") if isinstance(value.get("model_id"), str) else None,
        "missing": counts.get("missing") if isinstance(counts.get("missing"), int) else None,
    }


def check_writable(what="This"):
    """Raises ReadOnlyError on a replica."""
    if is_read_only():
        raise ReadOnlyError(what)


def check_model(model_id, what):
    """Raises ReadOnlyError when a replica is asked to load or download a model other than its index's."""
    value = marker()
    if value is not None and model_id != value.get("model_id"):
        raise ReadOnlyError(what)


# How a replica treats every route that changes something (method, path). tests/test_replica.py fails for a
# write route of either app that is in none of these, so a new route has to be thought through.
BLOCKED_ROUTES = frozenset({
    # require_writable: these only write the index, the media details or the folder list
    ("POST", "/index/clear"), ("POST", "/index/folder/delete"), ("POST", "/index/folders/batch-delete"),
    ("POST", "/index/folder/reindex"), ("POST", "/index/folders/batch-reindex"),
    ("POST", "/index/media-info/scan"),
})
CHECKED_ROUTES = frozenset({
    ("POST", "/queue/enqueue"), ("POST", "/queue/{task_id}/retry"),  # the task queue refuses indexing types
    ("POST", "/models/switch"), ("POST", "/models/download"),         # only the index's own model
    ("POST", "/models/delete"),                                         # the model files yes, the index no
})
ALLOWED_ROUTES = {
    ("POST", "/search"): "reads", ("POST", "/search/image"): "reads", ("POST", "/search/ref"): "reads",
    ("POST", "/search/video"): "reads", ("POST", "/browse"): "reads",
    ("POST", "/index/export"): "reads the index (a copy may be copied on)",
    ("POST", "/index/cancel"): "stops a task", ("POST", "/models/download/cancel"): "stops a download",
    ("POST", "/models/unload"): "frees memory",
    ("POST", "/image/cache/clear"): "this machine's cache",
    ("POST", "/video/thumbnails/regenerate"): "this machine's cache",
    ("POST", "/video/frames/batch-extract"): "this machine's cache",
    ("POST", "/settings/gpu"): "this machine's hardware",
    ("POST", "/queue/control"): "queue state", ("DELETE", "/queue/history"): "queue state",
    ("POST", "/queue/reorder"): "queue state", ("POST", "/queue/{task_id}/cancel"): "queue state",
    ("POST", "/queue/{task_id}/move"): "queue state", ("POST", "/queue/{task_id}/pause"): "queue state",
    ("POST", "/queue/{task_id}/resume"): "queue state",
    ("POST", "/auth/login"): "accounts", ("POST", "/auth/logout"): "accounts",
    ("POST", "/auth/password"): "accounts", ("POST", "/auth/sign-out-everywhere"): "accounts",
    ("POST", "/server/accounts"): "accounts", ("PATCH", "/server/accounts/{account_id}"): "accounts",
    ("POST", "/server/accounts/{account_id}/delete"): "accounts",
    ("POST", "/server/accounts/{account_id}/password"): "accounts",
    ("POST", "/server/accounts/{account_id}/sign-out"): "accounts",
    ("POST", "/sharing"): "this machine's sharing", ("POST", "/sharing/sign-out-everywhere"): "accounts",
    ("POST", "/sharing/accounts"): "accounts", ("POST", "/sharing/accounts/{account_id}"): "accounts",
    ("POST", "/sharing/accounts/{account_id}/delete"): "accounts",
    ("POST", "/sharing/accounts/{account_id}/password"): "accounts",
    ("POST", "/sharing/accounts/{account_id}/sign-out"): "accounts",
}


def check_task_type(task_type):
    """Raises ReadOnlyError when a replica is asked to queue a task that writes the index."""
    value = getattr(task_type, "value", task_type)
    if value in BLOCKED_TASK_TYPES and is_read_only():
        raise ReadOnlyError("Indexing")


def require_writable():
    """A route dependency: the route only writes the index, the media details or the folder list."""
    check_writable()


async def _handle(request: Request, exc: ReadOnlyError):
    return JSONResponse({"detail": str(exc), "code": READ_ONLY_CODE}, status_code=409)


def install(app):
    """Answers ReadOnlyError with 409 on `app` (the desktop app and the network app both install it)."""
    app.add_exception_handler(ReadOnlyError, _handle)


def reset_for_tests(value=None):
    """Sets the marker directly (tests)."""
    global _marker, _loaded
    _marker, _loaded = value, True
