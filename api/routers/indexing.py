import os
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import app_state
from auth_context import Auth, current_auth
from task_queue import TaskType
from routers.guards import check_index_target, require_indexed_path

router = APIRouter()

# What a viewer sees of /status: progress only, no file names, task payloads or error text
VIEWER_STATUS_KEYS = frozenset({
    "is_indexing", "progress", "percent", "total_files", "indexed_files", "is_loading_model",
    "is_downloading", "last_task_id", "has_active_task", "is_paused", "queue_pending_count",
    "queue_worker_state",
})

class FolderDeleteRequest(BaseModel):
    folder_path: str

class BatchFolderRequest(BaseModel):
    folder_paths: list[str]

@router.post("/index/clear")
def clear_index():
    try:
        app_state.indexer.clear_collection()
        return {"status": "success", "message": "Index cache cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/index/cancel")
def cancel_indexing():
    if app_state.task_queue.active_task:
        app_state.task_queue.cancel_task(app_state.task_queue.active_task.id)
    app_state.indexer.cancel_indexing()
    return {"status": "Indexing cancelled"}

@router.get("/index/folders")
def get_indexed_folders():
    try:
        folders = app_state.indexer.get_indexed_folders()
        return {"folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/index/folder/contents")
def get_indexed_folder_contents(
    folder_path: str = Query(...),
    limit: int = Query(50000, ge=1, le=100000),
    auth: Auth = Depends(current_auth),
):
    require_indexed_path(folder_path, auth=auth, is_folder=True)
    try:
        return app_state.indexer.get_folder_contents(folder_path, limit, skip_links=auth.is_network)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/index/folder/delete")
def delete_folder_index(req: FolderDeleteRequest):
    try:
        count = app_state.indexer.delete_folder_index(req.folder_path)
        app_state.indexer.request_warmup()
        return {"status": "success", "message": f"Deleted {count} entries for folder: {req.folder_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/index/folder/reindex")
def reindex_folder(req: FolderDeleteRequest, auth: Auth = Depends(current_auth)):
    folder_path = check_index_target(auth, req.folder_path)
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail="Invalid directory path.")

    t = app_state.task_queue.enqueue(
        TaskType.REINDEX_FOLDER,
        {"folder_path": folder_path},
        title=f"Reindex: {os.path.basename(folder_path) or folder_path}"
    )
    return {"status": "queued", "task_id": t.id, "target": folder_path}

@router.post("/index/folders/batch-delete")
def batch_delete_folders(req: BatchFolderRequest):
    try:
        count = app_state.indexer.batch_delete_folders(req.folder_paths)
        app_state.indexer.request_warmup()
        return {"status": "success", "message": f"Deleted entries for {len(req.folder_paths)} folders. Total records removed: {count}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/index/folders/batch-reindex")
def batch_reindex_folders(req: BatchFolderRequest, auth: Auth = Depends(current_auth)):
    canonical = [check_index_target(auth, p) for p in req.folder_paths]
    valid_dirs = [d for d in canonical if os.path.isdir(d)]
    if not valid_dirs:
        raise HTTPException(status_code=400, detail="No valid directory paths provided.")
    enqueued = []
    for d in valid_dirs:
        t = app_state.task_queue.enqueue(
            TaskType.REINDEX_FOLDER,
            {"folder_path": d},
            title=f"Reindex: {os.path.basename(d) or d}"
        )
        enqueued.append(t.to_dict())
    return {"status": "queued", "tasks": enqueued, "message": f"Enqueued {len(enqueued)} folder(s) for re-indexing."}

@router.post("/index/media-info/scan")
def scan_media_info():
    task, created = app_state.task_queue.enqueue_unique(TaskType.SCAN_MEDIA_INFO, {}, "Read media details")
    return {"status": "queued" if created else "duplicate", "task_id": task.id}

@router.get("/status")
def get_status(auth: Auth = Depends(current_auth)):
    status = app_state.indexer.get_status()
    # Augment with queue status
    queue_snap = app_state.task_queue.get_snapshot()
    active_task = queue_snap.get("active_task")
    status["queue_pending_count"] = queue_snap["pending_count"]
    status["queue_worker_state"] = queue_snap["worker_state"]
    status["has_active_task"] = active_task is not None
    status["active_task"] = active_task
    is_paused = (
        queue_snap["worker_state"] == "paused"
        or (active_task is not None and (active_task.get("is_paused") or active_task.get("status") == "paused"))
    )
    status["is_paused"] = is_paused
    if not auth.is_owner:
        return {key: value for key, value in status.items() if key in VIEWER_STATUS_KEYS}
    return status
