import shutil
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import app_state
import settings_store
from model_manager import AVAILABLE_MODELS
from task_queue import TaskStatus

router = APIRouter()

class ModelSwitchRequest(BaseModel):
    model_name: str
    clear_queue: bool = False
    force: bool = False

class ModelDeleteRequest(BaseModel):
    model_name: str
    delete_index: bool = False

def require_known_model(model_name: str):
    if model_name not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}")

@router.get("/models")
async def list_models():
    results = []
    for m in AVAILABLE_MODELS:
        status_info = app_state.model_manager.downloader.inspect_model_status(m)
        results.append({
            "id": m,
            "downloaded": status_info["downloaded"],
            "incomplete": status_info["incomplete"],
            "download_total_bytes": status_info["download_total_bytes"],
            "download_current_bytes": status_info["download_current_bytes"]
        })
    return {
        "active_model": app_state.model_manager.current_model_id,
        "models": results
    }

@router.post("/models/delete")
async def delete_model(req: ModelDeleteRequest):
    require_known_model(req.model_name)
    if (app_state.task_queue.active_task and app_state.task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED)) or app_state.indexer.is_indexing:
        raise HTTPException(status_code=409, detail="Cannot delete model while an indexing or rebuild task is in progress.")
    if app_state.model_manager.is_downloading:
        raise HTTPException(status_code=400, detail="Cannot delete model while a download is in progress.")

    model_id = req.model_name
    hub_path = app_state.model_manager.downloader.hub_path
    model_path = app_state.model_manager.downloader.get_model_path(model_id)
    locks_path = hub_path / ".locks" / model_path.name
    # Defense in depth: never rmtree anything that isn't a direct child of the hub (or its .locks)
    if (model_path.resolve().parent != hub_path.resolve()
            or locks_path.resolve().parent != (hub_path / ".locks").resolve()):
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_id}")

    # If the model to delete is currently active, unload it first
    if app_state.model_manager.current_model_id == model_id:
        app_state.model_manager.unload_model()
        app_state.task_queue.current_model_id = None
        app_state.task_queue._check_model_mismatch()
        app_state.task_queue.save_to_disk()

    # Deriving collection name manually to delete index if requested
    if req.delete_index:
        collection_name = model_id.replace("/", "_").replace("-", "_")
        app_state.indexer.delete_collection(collection_name)

    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model folder not found locally.")

    try:
        shutil.rmtree(model_path)
        # Also try to remove locks if any
        if locks_path.exists():
            shutil.rmtree(locks_path)

        return {"status": "success", "message": f"Model {model_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {str(e)}")

@router.post("/models/download")
async def download_model(req: ModelSwitchRequest, background_tasks: BackgroundTasks):
    require_known_model(req.model_name)
    if app_state.model_manager.is_downloading:
        return {"status": "Error", "message": "A download is already in progress."}

    def download_and_switch(model_name):
        try:
            # 1. Download model files without altering active model weights in memory
            status_info = app_state.model_manager.downloader.inspect_model_status(model_name)
            snapshot_dir = app_state.model_manager.get_model_snapshot_path(model_name)
            if not (status_info["downloaded"] and snapshot_dir is not None):
                app_state.model_manager.downloader.download_model(model_name)

            # 2. Check active model and queued tasks models
            is_model_active = app_state.model_manager.model is not None and app_state.model_manager.current_model_id is not None

            queued_model_ids = set()
            if app_state.task_queue.active_task and app_state.task_queue.active_task.model_id:
                queued_model_ids.add(app_state.task_queue.active_task.model_id)
            for t in app_state.task_queue.pending_queue:
                if t.model_id:
                    queued_model_ids.add(t.model_id)

            has_tasks = bool(
                app_state.task_queue.active_task or
                app_state.task_queue.pending_queue or
                app_state.indexer.is_indexing or
                app_state.indexer.is_rebuilding_video_thumbnails
            )

            # Check if this downloaded model matches all queued tasks
            matches_all_queued_tasks = bool(queued_model_ids and queued_model_ids == {model_name})

            # Auto-activate ONLY if:
            # 1. No tasks exist at all (clean state)
            # 2. OR no model is active and this downloaded model is the EXACT model expected by the queue
            should_auto_activate = False
            if not has_tasks:
                should_auto_activate = True
            elif not is_model_active and matches_all_queued_tasks:
                should_auto_activate = True

            if should_auto_activate:
                app_state.model_manager.load_model(model_name, local_files_only=True)
                app_state.indexer.switch_collection(app_state.model_manager.get_collection_name())
                settings_store.persist_active_model(model_name)
                app_state.task_queue.retarget_tasks_to_model(model_name)
                print(f"[ModelDownload] Successfully downloaded and auto-activated {model_name}")
            else:
                print(f"[ModelDownload] Successfully downloaded {model_name}. Preserving active model '{app_state.model_manager.current_model_id}' (queued tasks expect {queued_model_ids or 'existing active model'}).")
        except Exception as e:
            error_msg = str(e)
            if "cancelled by user" in error_msg.lower():
                error_msg = "Download cancelled by user"
            app_state.model_manager.download_error = error_msg
            print(f"Error downloading {model_name}: {error_msg}")

    background_tasks.add_task(download_and_switch, req.model_name)
    return {"status": "Downloading"}

@router.post("/models/download/cancel")
async def cancel_download():
    app_state.model_manager.cancel_download = True
    return {"status": "Cancellation requested"}

@router.post("/models/switch")
def switch_model(req: ModelSwitchRequest):
    require_known_model(req.model_name)
    # Guard: Cannot switch while an active task is running
    if app_state.task_queue.active_task and app_state.task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED):
        raise HTTPException(
            status_code=409,
            detail="Cannot switch models while an indexing or rebuild task is in progress. Please cancel the current task before switching."
        )
    if app_state.indexer.is_indexing or app_state.indexer.is_rebuilding_video_thumbnails:
        raise HTTPException(
            status_code=409,
            detail="Cannot switch models while indexing or rebuilding is in progress."
        )

    if req.clear_queue:
        with app_state.task_queue.lock:
            for task in list(app_state.task_queue.pending_queue):
                app_state.task_queue.cancel_task(task.id)

    try:
        app_state.model_manager.load_model(req.model_name, local_files_only=True)
        # Switching models connects to a different ChromaDB collection
        app_state.indexer.switch_collection(app_state.model_manager.get_collection_name())
        settings_store.persist_active_model(req.model_name)
        # Retarget remaining queued tasks to the newly activated model
        app_state.task_queue.retarget_tasks_to_model(req.model_name)
        return {"status": "Model switched correctly", "active_model": req.model_name}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Model not found locally: {str(e)}")

@router.post("/models/unload")
def unload_model():
    if (app_state.task_queue.active_task and app_state.task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED)) or app_state.indexer.is_indexing:
        raise HTTPException(status_code=409, detail="Cannot unload or eject model while an indexing task is in progress.")
    try:
        app_state.model_manager.unload_model()
        app_state.task_queue.current_model_id = None
        app_state.task_queue._check_model_mismatch()
        app_state.task_queue.save_to_disk()
        return {"status": "success", "message": "Model unloaded and VRAM cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unload model: {str(e)}")
