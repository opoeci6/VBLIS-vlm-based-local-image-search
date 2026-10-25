import os
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import app_state
import task_queue as task_queue_module
from task_queue import TaskType

router = APIRouter()

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

@router.post("/queue/enqueue")
def enqueue_task_endpoint(req: EnqueueTaskRequest):
    if not task_queue_module.is_supported_task_type(req.type):
        raise HTTPException(status_code=400, detail=f"Unsupported task type: {req.type.value}")
    if req.type == TaskType.INDEX_FOLDERS and "folder_paths" in req.payload:
        paths = [os.path.abspath(os.path.normpath(p)) for p in req.payload["folder_paths"]]
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
def retry_queue_task(task_id: str):
    new_task = app_state.task_queue.retry_task(task_id)
    if not new_task:
        raise HTTPException(status_code=404, detail="Historical task not found.")
    return {"status": "success", "task": new_task.to_dict()}

@router.delete("/queue/history")
def clear_queue_history():
    count = app_state.task_queue.clear_history()
    return {"status": "success", "cleared_count": count}
