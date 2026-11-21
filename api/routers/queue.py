import os
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import app_state
import task_queue as task_queue_module
from auth_context import Auth, current_auth
from routers.guards import check_index_target, payload_folders
from task_queue import TaskType

router = APIRouter()

# From the network only these can be queued here; the rest have their own routes or are desktop-only
NETWORK_TASK_TYPES = frozenset({TaskType.INDEX_FOLDERS, TaskType.SCAN_MEDIA_INFO})
MAX_FOLDERS_PER_REQUEST = 100

class EnqueueTaskRequest(BaseModel):
    type: TaskType
    payload: dict = {}
    title: str = ""
    priority: str = "bottom"

class WorkerControlRequest(BaseModel):
    action: str  # start | pause_immediate | pause_after_current | adopt_active_model
    adopt_model: bool = False

class MoveTaskRequest(BaseModel):
    direction: str  # up | down | top | bottom

class ReorderTasksRequest(BaseModel):
    task_ids: List[str]

@router.get("/queue")
def get_queue_snapshot():
    return app_state.task_queue.get_snapshot()

def _check_network_enqueue(req: EnqueueTaskRequest):
    if req.type not in NETWORK_TASK_TYPES:
        raise HTTPException(status_code=403, detail="This task can't be queued from the network.")
    if req.type == TaskType.INDEX_FOLDERS:
        folder_paths = req.payload.get("folder_paths")
        if (
            set(req.payload) != {"folder_paths"}
            or not isinstance(folder_paths, list)
            or not 0 < len(folder_paths) <= MAX_FOLDERS_PER_REQUEST
        ):
            raise HTTPException(status_code=400, detail="folder_paths must be a list of folder paths.")


@router.post("/queue/enqueue")
def enqueue_task_endpoint(req: EnqueueTaskRequest, auth: Auth = Depends(current_auth)):
    if not task_queue_module.is_supported_task_type(req.type):
        raise HTTPException(status_code=400, detail=f"Unsupported task type: {req.type.value}")
    if auth.is_network:
        _check_network_enqueue(req)
    if req.type == TaskType.SCAN_MEDIA_INFO:
        task, created = app_state.task_queue.enqueue_unique(
            req.type, {}, title=req.title, priority=req.priority
        )
        return {
            "status": "queued" if created else "duplicate",
            "task": task.to_dict(),
            "message": f"Task '{task.title}' enqueued." if created else f"Task '{task.title}' is already queued."
        }
    if req.type == TaskType.INDEX_FOLDERS and "folder_paths" in req.payload:
        paths = [check_index_target(auth, p) for p in payload_folders({"folder_paths": req.payload["folder_paths"]})]
        if auth.is_network:
            for p in paths:
                if not os.path.isdir(p):
                    raise HTTPException(status_code=400, detail=f"Not a folder: {p}")
        added_tasks = []
        duplicates = []
        for p in paths:
            dup = app_state.task_queue.is_folder_in_queue(p)
            if dup:
                duplicates.append({"path": p, "info": dup})
            else:
                t = app_state.task_queue.enqueue(
                    TaskType.INDEX_FOLDERS,
                    {"folder_paths": [p]},
                    title=f"Index: {os.path.basename(os.path.normpath(p)) or p}",
                    priority=req.priority
                )
                added_tasks.append(t.to_dict())
        return {
            "status": "queued" if added_tasks else "duplicate",
            "tasks": added_tasks,
            "duplicates": duplicates,
            "message": f"Enqueued {len(added_tasks)} task(s)." + (f" ({len(duplicates)} duplicate(s) skipped)" if duplicates else "")
        }

    payload = dict(req.payload)
    if isinstance(payload.get("folder_path"), str):
        payload["folder_path"] = os.path.abspath(os.path.normpath(payload["folder_path"]))
    if isinstance(payload.get("folder_paths"), list):
        payload["folder_paths"] = [
            os.path.abspath(os.path.normpath(p)) if isinstance(p, str) else p for p in payload["folder_paths"]
        ]
    task = app_state.task_queue.enqueue(req.type, payload, title=req.title, priority=req.priority)
    return {
        "status": "queued",
        "task": task.to_dict(),
        "position": len(app_state.task_queue.pending_queue),
        "message": f"Task '{task.title}' enqueued."
    }

@router.post("/queue/control")
def control_queue_worker(req: WorkerControlRequest):
    res = app_state.task_queue.control_worker(req.action, adopt_model=req.adopt_model)
    if res.get("success") is False:
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to start worker."))
    return {"status": "success", "result": res}

@router.post("/queue/{task_id}/cancel")
def cancel_queue_task(task_id: str):
    success = app_state.task_queue.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or could not be cancelled.")
    return {"status": "success", "message": f"Task {task_id} cancelled."}

@router.post("/queue/{task_id}/pause")
def pause_queue_task(task_id: str):
    success = app_state.task_queue.pause_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task is not active or could not be paused.")
    return {"status": "success", "message": f"Task {task_id} paused."}

@router.post("/queue/{task_id}/resume")
def resume_queue_task(task_id: str):
    success = app_state.task_queue.resume_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task is not active or could not be resumed.")
    return {"status": "success", "message": f"Task {task_id} resumed."}

@router.post("/queue/{task_id}/move")
def move_queue_task(task_id: str, req: MoveTaskRequest):
    success = app_state.task_queue.move_task(task_id, req.direction)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to move task.")
    return {"status": "success", "message": f"Task {task_id} moved {req.direction}."}

@router.post("/queue/reorder")
def reorder_queue_tasks(req: ReorderTasksRequest):
    app_state.task_queue.reorder_tasks(req.task_ids)
    return {"status": "success", "message": "Queue reordered successfully."}

@router.post("/queue/{task_id}/retry")
def retry_queue_task(task_id: str, auth: Auth = Depends(current_auth)):
    if auth.is_network:
        # The task may come from the desktop, where any folder is allowed: check it again
        found = app_state.task_queue.history_task(task_id)
        if found is None:
            raise HTTPException(status_code=404, detail="Historical task not found.")
        if found[0] == TaskType.EXPORT_INDEX:  # writes a file on the desktop: the desktop app only
            raise HTTPException(status_code=403, detail="This task can't be queued from the network.")
        for folder in payload_folders(found[1]):
            check_index_target(auth, folder)
    new_task = app_state.task_queue.retry_task(task_id)
    if not new_task:
        raise HTTPException(status_code=404, detail="Historical task not found.")
    return {"status": "success", "task": new_task.to_dict()}

@router.delete("/queue/history")
def clear_queue_history():
    count = app_state.task_queue.clear_history()
    return {"status": "success", "cleared_count": count}
