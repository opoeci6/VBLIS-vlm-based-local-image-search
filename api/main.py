from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, UploadFile, File
import torch
from typing import List, Optional, Dict, Any, Literal

from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn
import os
import sys
import io
import struct
import pathlib
from dotenv import load_dotenv
import shutil
import hashlib
from PIL import Image, ImageOps
import pillow_heif

# Electron reads our stdout/stderr pipes as UTF-8, but they default to the ANSI code page, so
# printing a path it can't encode would raise. The frozen build ignores PYTHONUTF8/PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")

pillow_heif.register_heif_opener()

# EXIF orientation tag ID
_EXIF_ORIENTATION_TAG = 0x0112

# Maps EXIF orientation value -> (PIL transpose methods to apply in order)
_ORIENTATION_TRANSFORMS = {
    2: [Image.FLIP_LEFT_RIGHT],
    3: [Image.ROTATE_180],
    4: [Image.FLIP_TOP_BOTTOM],
    5: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_90],
    6: [Image.ROTATE_270],
    7: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_270],
    8: [Image.ROTATE_90],
}

def _parse_exif_orientation(exif_bytes: bytes) -> int:
    """Parse the EXIF orientation tag directly from raw EXIF bytes (TIFF structure).
    Returns the orientation value (1-8), or 1 (no rotation) if not found."""
    try:
        # Strip optional 'Exif\x00\x00' header to get to the TIFF data
        tiff = exif_bytes[6:] if exif_bytes.startswith(b"Exif\x00\x00") else exif_bytes
        if len(tiff) < 8:
            return 1
        # Determine byte order
        byte_order = tiff[:2]
        if byte_order == b"II":
            endian = "<"   # little-endian
        elif byte_order == b"MM":
            endian = ">"   # big-endian
        else:
            return 1
        # Read offset to first IFD
        ifd_offset = struct.unpack(endian + "I", tiff[4:8])[0]
        if ifd_offset + 2 > len(tiff):
            return 1
        num_entries = struct.unpack(endian + "H", tiff[ifd_offset:ifd_offset + 2])[0]
        for i in range(num_entries):
            entry_offset = ifd_offset + 2 + i * 12
            if entry_offset + 12 > len(tiff):
                break
            tag = struct.unpack(endian + "H", tiff[entry_offset:entry_offset + 2])[0]
            if tag == _EXIF_ORIENTATION_TAG:
                value = struct.unpack(endian + "H", tiff[entry_offset + 8:entry_offset + 10])[0]
                return value
    except Exception:
        pass
    return 1

def _apply_exif_orientation(img: Image.Image, exif_bytes: bytes) -> Image.Image:
    """Rotate/flip a PIL image to correct orientation based on raw EXIF bytes."""
    orientation = _parse_exif_orientation(exif_bytes)
    transforms = _ORIENTATION_TRANSFORMS.get(orientation, [])
    for t in transforms:
        img = img.transpose(t)
    return img


# Ensure we load the .env from the data root (see paths.py), and strictly enforce HF_HOME
import paths
import security
# Packaged builds only: move data an older build kept in the install folder (before anything opens it)
try:
    _migration = paths.migrate_legacy_data()
except paths.MigrationLockedError as e:
    sys.exit(f"[DataMigration] {e}; not starting.")
if "failed" in _migration.values():
    # Starting now would create fresh, empty state next to the half-migrated data; exit so the
    # next launch retries the move instead of shadowing the old copy forever
    failed = ", ".join(name for name, outcome in _migration.items() if outcome == "failed")
    sys.exit(f"[DataMigration] Could not move {failed} into {paths.DATA_ROOT}; not starting.")
# The token comes only from the launching process, never from .env (which overrides the environment)
API_TOKEN = security.resolve_api_token()
load_dotenv(paths.ENV_FILE, override=True)
os.environ["HF_HOME"] = str(paths.MODELS_DIR)
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "30"
os.environ["HF_HUB_ENABLE_EMERGENCY_RETRY"] = "False"

paths.ensure_dirs()
CACHE_DIR = paths.CACHE_DIR
DATA_DIR = paths.DATA_DIR

def compute_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

def persist_active_model(model_name: str):
    try:
        env_path = paths.ENV_FILE
        lines = []
        if env_path.exists():
            with open(env_path, "r") as f:
                lines = f.readlines()
        
        updated = False
        new_lines = []
        for line in lines:
            if line.startswith("ACTIVE_MODEL="):
                new_lines.append(f"ACTIVE_MODEL={model_name}\n")
                updated = True
            else:
                new_lines.append(line)
        if not updated:
            new_lines.append(f"ACTIVE_MODEL={model_name}\n")
            
        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"Failed to persist active model: {e}")

from model_manager import ModelManager, AVAILABLE_MODELS
from indexer import (
    Indexer, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extract_video_frame, extract_video_frames_batch,
    get_video_frame_cache_path, IMAGE_CACHE_DIR, VIDEO_CACHE_DIR,
    get_cache_stats, safe_clear_cache
)
from task_queue import TaskQueueManager, TaskType, TaskStatus, WorkerState
from thumbnail_cache import get_or_create_thumbnail, save_jpeg_thumbnail

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # uvicorn has configured logging by now; keep ?token= out of its access log
    security.install_access_log_redaction()
    # Initialize indexer and models gracefully
    print("Starting API backend...")
    active_model = os.getenv("ACTIVE_MODEL", "google/siglip2-base-patch16-224")
    try:
        print(f"Loading last active model: {active_model}")
        model_manager.load_model(active_model, local_files_only=True)
        indexer.switch_collection(model_manager.get_collection_name())
    except Exception as e:
        print(f"[Notice] Active model '{active_model}' not loaded: {e}. Ready for manual download.")
    task_queue.load_from_disk(current_active_model=model_manager.active_model)
    task_queue.start()
    yield
    print("Shutting down API backend...")
    task_queue.stop()

app = FastAPI(title="Local Image Search API", lifespan=lifespan)

# Only clients holding the token (the Electron app passes it via env) may call the API
security.install(app, API_TOKEN)

model_manager = ModelManager()
indexer = Indexer(model_manager)
task_queue = TaskQueueManager(indexer, persistence_path=str(DATA_DIR / "task_queue.json"))

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = 0.20

class IndexRequest(BaseModel):
    directory: str

class VideoBatchExtractRequest(BaseModel):
    path: str
    timestamps: list[float]

class ModelSwitchRequest(BaseModel):
    model_name: str
    clear_queue: bool = False
    force: bool = False

class ModelDeleteRequest(BaseModel):
    model_name: str
    delete_index: bool = False

class FolderDeleteRequest(BaseModel):
    folder_path: str

class BatchFolderRequest(BaseModel):
    folder_paths: list[str]

class GPUSettingsRequest(BaseModel):
    use_gpu: bool
    batch_size: int = 0
    precision_mode: Literal["auto", "fp16", "fp32"] = "auto"

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

def require_indexed_path(path: str, extensions=None):
    """403 unless path is inside an indexed folder (and has an allowed extension, when given).
    Runs before any existence check so the API can't be used to probe files elsewhere."""
    if not indexer.is_path_in_indexed_folders(path):
        raise HTTPException(status_code=403, detail="Path is not inside an indexed folder")
    if extensions is not None and os.path.splitext(path)[1].lower() not in extensions:
        raise HTTPException(status_code=403, detail="Unsupported file type")

def require_known_model(model_name: str):
    if model_name not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}")

@app.get("/settings/gpu")
async def get_gpu_settings():
    print(f"GPU settings requested: {model_manager.use_gpu}, {torch.cuda.is_available()}")
    return {
        "use_gpu": model_manager.use_gpu,
        "cuda_available": torch.cuda.is_available(),
        "device": model_manager.device,
        "batch_size": model_manager.batch_size,
        "effective_batch_size": model_manager.get_effective_batch_size(),
        "precision_mode": model_manager.precision_mode,
        "active_precision": model_manager.get_active_precision(),
        "fp16_supported": model_manager.check_fp16_support(),
        "gpu_name": model_manager.get_gpu_name(),
        "oom_triggered": model_manager.oom_triggered,
        "oom_triggered_count": model_manager.oom_triggered_count
    }

@app.post("/settings/gpu")
async def set_gpu_settings(req: GPUSettingsRequest):
    print(f"Set GPU settings requested: GPU={req.use_gpu}, Batch={req.batch_size}, Precision={req.precision_mode}")
    result = model_manager.set_device(req.use_gpu)
    model_manager.batch_size = max(0, req.batch_size)
    model_manager.precision_mode = req.precision_mode.lower()
    
    # Persist settings to .env
    try:
        env_path = paths.ENV_FILE
        lines = []
        if env_path.exists():
            with open(env_path, "r") as f:
                lines = f.readlines()
        
        settings_map = {
            "USE_GPU=": f"USE_GPU={req.use_gpu}\n",
            "BATCH_SIZE=": f"BATCH_SIZE={model_manager.batch_size}\n",
            "PRECISION_MODE=": f"PRECISION_MODE={model_manager.precision_mode}\n"
        }
        
        new_lines = []
        updated_keys = set()
        for line in lines:
            matched = False
            for key, val in settings_map.items():
                if line.startswith(key):
                    new_lines.append(val)
                    updated_keys.add(key)
                    matched = True
                    break
            if not matched:
                new_lines.append(line)
        
        for key, val in settings_map.items():
            if key not in updated_keys:
                new_lines.append(val)
            
        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"Failed to persist GPU settings: {e}")

    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    
    res_dict = await get_gpu_settings()
    res_dict["status"] = "success"
    res_dict["message"] = result["message"]
    return res_dict

@app.post("/search")
def search_images(req: SearchQuery):
    if not req.query.strip():
        return {"results": []}
    
    try:
        results = indexer.search(req.query, req.top_k, req.min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search/image")
async def search_images_by_file(file: UploadFile = File(...), top_k: int = 50, min_score: float = 0.15):
    if file.size is not None and file.size > security.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload too large (max 50 MB)")
    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        results = indexer.search_by_image(img, top_k, min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index")
async def start_indexing(req: IndexRequest):
    if not os.path.isdir(req.directory):
        raise HTTPException(status_code=400, detail="Invalid directory path.")
    
    dup = task_queue.is_folder_in_queue(req.directory)
    if dup:
        return {"status": "duplicate", "message": f"Folder '{req.directory}' is already in the queue.", "info": dup}

    task = task_queue.enqueue(
        TaskType.INDEX_FOLDERS,
        {"folder_paths": [req.directory]},
        title=f"Index: {os.path.basename(os.path.normpath(req.directory)) or req.directory}"
    )
    return {"status": "queued", "task_id": task.id, "target": req.directory}

@app.post("/index/folders/batch-index")
async def batch_index_folders(req: BatchFolderRequest):
    # Filter out invalid directories
    valid_dirs = [d for d in req.folder_paths if os.path.isdir(d)]
    if not valid_dirs:
        raise HTTPException(status_code=400, detail="No valid directory paths provided.")
    
    enqueued_tasks = []
    duplicates = []
    for d in valid_dirs:
        dup = task_queue.is_folder_in_queue(d)
        if dup:
            duplicates.append({"path": d, "info": dup})
        else:
            t = task_queue.enqueue(
                TaskType.INDEX_FOLDERS,
                {"folder_paths": [d]},
                title=f"Index: {os.path.basename(os.path.normpath(d)) or d}"
            )
            enqueued_tasks.append(t.to_dict())
            
    return {
        "status": "queued" if enqueued_tasks else "duplicate",
        "task_ids": [t["id"] for t in enqueued_tasks],
        "tasks": enqueued_tasks,
        "duplicates": duplicates,
        "message": f"Enqueued {len(enqueued_tasks)} folder(s)." + (f" ({len(duplicates)} duplicate(s) skipped)" if duplicates else "")
    }

@app.post("/index/clear")
def clear_index():
    try:
        indexer.clear_collection()
        return {"status": "success", "message": "Index cache cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/maintenance")
def run_maintenance():
    try:
        result = indexer.run_maintenance()
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/index/folders")
def get_indexed_folders():
    try:
        folders = indexer.get_indexed_folders()
        return {"folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/index/folder/contents")
def get_indexed_folder_contents(
    folder_path: str = Query(...),
    limit: int = Query(50000, ge=1, le=100000)
):
    require_indexed_path(folder_path)
    try:
        return indexer.get_folder_contents(folder_path, limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folder/delete")
def delete_folder_index(req: FolderDeleteRequest):
    try:
        count = indexer.delete_folder_index(req.folder_path)
        return {"status": "success", "message": f"Deleted {count} entries for folder: {req.folder_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folder/reindex")
async def reindex_folder(req: FolderDeleteRequest):
    if not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="Invalid directory path.")
    
    t = task_queue.enqueue(
        TaskType.REINDEX_FOLDER,
        {"folder_path": req.folder_path},
        title=f"Reindex: {os.path.basename(os.path.normpath(req.folder_path)) or req.folder_path}"
    )
    return {"status": "queued", "task_id": t.id, "target": req.folder_path}

@app.post("/index/folders/batch-delete")
def batch_delete_folders(req: BatchFolderRequest):
    try:
        count = indexer.batch_delete_folders(req.folder_paths)
        return {"status": "success", "message": f"Deleted entries for {len(req.folder_paths)} folders. Total records removed: {count}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folders/batch-reindex")
async def batch_reindex_folders(req: BatchFolderRequest):
    valid_dirs = [d for d in req.folder_paths if os.path.isdir(d)]
    if not valid_dirs:
        raise HTTPException(status_code=400, detail="No valid directory paths provided.")
    enqueued = []
    for d in valid_dirs:
        t = task_queue.enqueue(
            TaskType.REINDEX_FOLDER,
            {"folder_path": d},
            title=f"Reindex: {os.path.basename(os.path.normpath(d)) or d}"
        )
        enqueued.append(t.to_dict())
    return {"status": "queued", "tasks": enqueued, "message": f"Enqueued {len(enqueued)} folder(s) for re-indexing."}

@app.get("/status")
async def get_status():
    status = indexer.get_status()
    # Augment with queue status
    queue_snap = task_queue.get_snapshot()
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
    return status

# ================= Task Queue API =================

@app.get("/queue")
def get_queue_snapshot():
    return task_queue.get_snapshot()

@app.post("/queue/enqueue")
def enqueue_task_endpoint(req: EnqueueTaskRequest):
    if req.type == TaskType.INDEX_FOLDERS and "folder_paths" in req.payload:
        paths = req.payload["folder_paths"]
        added_tasks = []
        duplicates = []
        for p in paths:
            dup = task_queue.is_folder_in_queue(p)
            if dup:
                duplicates.append({"path": p, "info": dup})
            else:
                t = task_queue.enqueue(
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
    
    task = task_queue.enqueue(req.type, req.payload, title=req.title, priority=req.priority)
    return {
        "status": "queued",
        "task": task.to_dict(),
        "position": len(task_queue.pending_queue),
        "message": f"Task '{task.title}' enqueued."
    }

@app.post("/queue/control")
def control_queue_worker(req: WorkerControlRequest):
    res = task_queue.control_worker(req.action, adopt_model=req.adopt_model)
    if res.get("success") is False:
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to start worker."))
    return {"status": "success", "result": res}

@app.post("/queue/{task_id}/cancel")
def cancel_queue_task(task_id: str):
    success = task_queue.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or could not be cancelled.")
    return {"status": "success", "message": f"Task {task_id} cancelled."}

@app.post("/queue/{task_id}/pause")
def pause_queue_task(task_id: str):
    success = task_queue.pause_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task is not active or could not be paused.")
    return {"status": "success", "message": f"Task {task_id} paused."}

@app.post("/queue/{task_id}/resume")
def resume_queue_task(task_id: str):
    success = task_queue.resume_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task is not active or could not be resumed.")
    return {"status": "success", "message": f"Task {task_id} resumed."}

@app.post("/queue/{task_id}/move")
def move_queue_task(task_id: str, req: MoveTaskRequest):
    success = task_queue.move_task(task_id, req.direction)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to move task.")
    return {"status": "success", "message": f"Task {task_id} moved {req.direction}."}

@app.post("/queue/reorder")
def reorder_queue_tasks(req: ReorderTasksRequest):
    task_queue.reorder_tasks(req.task_ids)
    return {"status": "success", "message": "Queue reordered successfully."}

@app.post("/queue/{task_id}/retry")
def retry_queue_task(task_id: str):
    new_task = task_queue.retry_task(task_id)
    if not new_task:
        raise HTTPException(status_code=404, detail="Historical task not found.")
    return {"status": "success", "task": new_task.to_dict()}

@app.delete("/queue/history")
def clear_queue_history():
    count = task_queue.clear_history()
    return {"status": "success", "cleared_count": count}

# ================= Model Management =================

@app.get("/models")
async def list_models():
    results = []
    for m in AVAILABLE_MODELS:
        status_info = model_manager.downloader.inspect_model_status(m)
        results.append({
            "id": m,
            "downloaded": status_info["downloaded"],
            "incomplete": status_info["incomplete"],
            "download_total_bytes": status_info["download_total_bytes"],
            "download_current_bytes": status_info["download_current_bytes"]
        })
    return {
        "active_model": model_manager.current_model_id,
        "models": results
    }

@app.post("/index/cancel")
def cancel_indexing():
    if task_queue.active_task:
        task_queue.cancel_task(task_queue.active_task.id)
    indexer.cancel_indexing()
    return {"status": "Indexing cancelled"}

@app.post("/models/delete")
async def delete_model(req: ModelDeleteRequest):
    require_known_model(req.model_name)
    if (task_queue.active_task and task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED)) or indexer.is_indexing:
        raise HTTPException(status_code=409, detail="Cannot delete model while an indexing or rebuild task is in progress.")
    if model_manager.is_downloading:
        raise HTTPException(status_code=400, detail="Cannot delete model while a download is in progress.")
        
    model_id = req.model_name
    hub_path = model_manager.downloader.hub_path
    model_path = model_manager.downloader.get_model_path(model_id)
    locks_path = hub_path / ".locks" / model_path.name
    # Defense in depth: never rmtree anything that isn't a direct child of the hub (or its .locks)
    if (model_path.resolve().parent != hub_path.resolve()
            or locks_path.resolve().parent != (hub_path / ".locks").resolve()):
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_id}")

    # If the model to delete is currently active, unload it first
    if model_manager.current_model_id == model_id:
        model_manager.unload_model()
        task_queue.current_model_id = None
        task_queue._check_model_mismatch()
        task_queue.save_to_disk()
    
    # Deriving collection name manually to delete index if requested
    if req.delete_index:
        collection_name = model_id.replace("/", "_").replace("-", "_")
        indexer.delete_collection(collection_name)

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

@app.post("/models/download")
async def download_model(req: ModelSwitchRequest, background_tasks: BackgroundTasks):
    require_known_model(req.model_name)
    if model_manager.is_downloading:
        return {"status": "Error", "message": "A download is already in progress."}
    
    def download_and_switch(model_name):
        try:
            # 1. Download model files without altering active model weights in memory
            status_info = model_manager.downloader.inspect_model_status(model_name)
            snapshot_dir = model_manager.get_model_snapshot_path(model_name)
            if not (status_info["downloaded"] and snapshot_dir is not None):
                model_manager.downloader.download_model(model_name)
            
            # 2. Check active model and queued tasks models
            is_model_active = model_manager.model is not None and model_manager.current_model_id is not None
            
            queued_model_ids = set()
            if task_queue.active_task and task_queue.active_task.model_id:
                queued_model_ids.add(task_queue.active_task.model_id)
            for t in task_queue.pending_queue:
                if t.model_id:
                    queued_model_ids.add(t.model_id)

            has_tasks = bool(
                task_queue.active_task or 
                task_queue.pending_queue or 
                indexer.is_indexing or 
                indexer.is_rebuilding_video_thumbnails
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
                model_manager.load_model(model_name, local_files_only=True)
                indexer.switch_collection(model_manager.get_collection_name())
                persist_active_model(model_name)
                task_queue.retarget_tasks_to_model(model_name)
                print(f"[ModelDownload] Successfully downloaded and auto-activated {model_name}")
            else:
                print(f"[ModelDownload] Successfully downloaded {model_name}. Preserving active model '{model_manager.current_model_id}' (queued tasks expect {queued_model_ids or 'existing active model'}).")
        except Exception as e:
            error_msg = str(e)
            if "cancelled by user" in error_msg.lower():
                error_msg = "Download cancelled by user"
            model_manager.download_error = error_msg
            print(f"Error downloading {model_name}: {error_msg}")

    background_tasks.add_task(download_and_switch, req.model_name)
    return {"status": "Downloading"}

@app.post("/models/download/cancel")
async def cancel_download():
    model_manager.cancel_download = True
    return {"status": "Cancellation requested"}

@app.post("/models/switch")
def switch_model(req: ModelSwitchRequest):
    require_known_model(req.model_name)
    # Guard: Cannot switch while an active task is running
    if task_queue.active_task and task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED):
        raise HTTPException(
            status_code=409,
            detail="Cannot switch models while an indexing or rebuild task is in progress. Please cancel the current task before switching."
        )
    if indexer.is_indexing or indexer.is_rebuilding_video_thumbnails:
        raise HTTPException(
            status_code=409,
            detail="Cannot switch models while indexing or rebuilding is in progress."
        )
    
    if req.clear_queue:
        with task_queue.lock:
            for task in list(task_queue.pending_queue):
                task_queue.cancel_task(task.id)

    try:
        model_manager.load_model(req.model_name, local_files_only=True)
        # Switching models connects to a different ChromaDB collection
        indexer.switch_collection(model_manager.get_collection_name())
        persist_active_model(req.model_name)
        # Retarget remaining queued tasks to the newly activated model
        task_queue.retarget_tasks_to_model(req.model_name)
        return {"status": "Model switched correctly", "active_model": req.model_name}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Model not found locally: {str(e)}")

@app.post("/models/unload")
def unload_model():
    if (task_queue.active_task and task_queue.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED)) or indexer.is_indexing:
        raise HTTPException(status_code=409, detail="Cannot unload or eject model while an indexing task is in progress.")
    try:
        model_manager.unload_model()
        task_queue.current_model_id = None
        task_queue._check_model_mismatch()
        task_queue.save_to_disk()
        return {"status": "success", "message": "Model unloaded and VRAM cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unload model: {str(e)}")

@app.get("/image/cache/stats")
def get_cache_statistics():
    return get_cache_stats()

@app.post("/image/cache/clear")
def clear_image_cache(target: str = Query("all", pattern="^(all|images|videos)$")):
    try:
        result = safe_clear_cache(target=target)
        return {"status": "success", "message": f"Successfully cleared {target} thumbnail cache.", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/video/frames/batch-extract")
def batch_extract_video_frames(req: VideoBatchExtractRequest):
    require_indexed_path(req.path, VIDEO_EXTENSIONS)
    if not os.path.isfile(req.path):
        raise HTTPException(status_code=404, detail="Video file not found")
    try:
        cached_paths = extract_video_frames_batch(req.path, req.timestamps, VIDEO_CACHE_DIR)
        return {"status": "success", "cached_count": len(cached_paths)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/video/thumbnails/regenerate")
async def regenerate_video_thumbnails():
    t = task_queue.enqueue(
        TaskType.REBUILD_VIDEO_THUMBNAILS,
        {},
        title="Rebuild Video Thumbnails"
    )
    return {"status": "queued", "task_id": t.id, "message": "Video thumbnail regeneration added to queue."}

@app.get("/image")
def serve_image(
    path: str = Query(...),
    size: str = "full",
    timestamp: float = Query(0.0, ge=0.0)
):
    """Serve a local image file by absolute path. Transcodes HEIC to JPEG.
    Supports size='thumbnail' for faster loading in the UI grid.
    Thumbnails are cached on disk in segregated 'cache/images' and 'cache/videos' directories.
    """
    require_indexed_path(path, IMAGE_EXTENSIONS | VIDEO_EXTENSIONS)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(path)[1].lower()
    is_heic = ext in (".heic", ".heif")
    is_video = ext in VIDEO_EXTENSIONS

    if is_video:
        try:
            stat = os.stat(path)
            cache_path = get_video_frame_cache_path(path, timestamp, VIDEO_CACHE_DIR, stat)

            if size == "thumbnail":
                def render_frame_thumbnail(fp):
                    frame = extract_video_frame(path, timestamp)
                    save_jpeg_thumbnail(frame, fp)
                    frame.close()

                return FileResponse(get_or_create_thumbnail(cache_path, render_frame_thumbnail))

            frame = extract_video_frame(path, timestamp)
            buffer = io.BytesIO()
            frame.convert("RGB").save(buffer, format="JPEG", quality=90)
            frame.close()
            buffer.seek(0)
            return StreamingResponse(buffer, media_type="image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to decode video frame: {str(e)}")
    
    # If thumbnail is requested, check cache first
    if size == "thumbnail":
        file_hash = compute_hash(path)
        cache_path = IMAGE_CACHE_DIR / f"{file_hash}_thumb.jpg"
        legacy_path = CACHE_DIR / f"{file_hash}_thumb.jpg"

        def render_image_thumbnail(fp):
            if is_heic:
                heif_file = pillow_heif.open_heif(path)
                img = Image.frombytes(
                    heif_file.mode,
                    heif_file.size,
                    heif_file.data,
                    "raw",
                )
                exif_bytes = heif_file.info.get("exif", b"")
                if exif_bytes:
                    img = _apply_exif_orientation(img, exif_bytes)
            else:
                img = Image.open(path)
                img = ImageOps.exif_transpose(img)
            save_jpeg_thumbnail(img, fp)

        try:
            return FileResponse(get_or_create_thumbnail(cache_path, render_image_thumbnail, legacy_path))
        except Exception as e:
            # Fallback to full image if thumbnail generation fails, but log it
            print(f"Thumbnail generation failed: {e}")
            pass

    # Serve full image (with HEIC transcoding if necessary)
    if is_heic:
        try:
            heif_file = pillow_heif.open_heif(path)
            img = Image.frombytes(
                heif_file.mode,
                heif_file.size,
                heif_file.data,
                "raw",
            )
            exif_bytes = heif_file.info.get("exif", b"")
            if exif_bytes:
                img = _apply_exif_orientation(img, exif_bytes)
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=90)
            buf.seek(0)
            return StreamingResponse(buf, media_type="image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to transcode HEIC: {str(e)}")
    
    return FileResponse(path)

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    import parent_watch
    parent_watch.start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
