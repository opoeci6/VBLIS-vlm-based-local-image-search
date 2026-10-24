import os
import time
import json
import uuid
import threading
from enum import Enum
from typing import Optional, List, Dict, Any

import paths


class TaskType(str, Enum):
    INDEX_FOLDERS = "INDEX_FOLDERS"
    REINDEX_FOLDER = "REINDEX_FOLDER"
    BATCH_REINDEX = "BATCH_REINDEX"
    REBUILD_VIDEO_THUMBNAILS = "REBUILD_VIDEO_THUMBNAILS"
    PRUNE_DELETED = "PRUNE_DELETED"
    CLEAR_CACHE = "CLEAR_CACHE"


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WorkerState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING_AFTER_CURRENT = "stopping_after_current"


class Task:
    def __init__(
        self,
        task_type: TaskType,
        payload: Dict[str, Any],
        title: str = "",
        task_id: Optional[str] = None,
        model_id: Optional[str] = None
    ):
        self.id: str = task_id or str(uuid.uuid4())
        self.type: TaskType = task_type
        self.title: str = title or self._generate_default_title(task_type, payload)
        self.payload: Dict[str, Any] = payload
        self.model_id: Optional[str] = model_id
        self.status: TaskStatus = TaskStatus.QUEUED
        self.progress: float = 0.0
        self.current_item: str = ""
        self.processed_count: int = 0
        self.total_count: int = 0
        self.error_count: int = 0
        self.errors: List[str] = []
        self.created_at: float = time.time()
        self.started_at: Optional[float] = None
        self.completed_at: Optional[float] = None
        self.cancel_requested: bool = False
        self._pause_event: threading.Event = threading.Event()
        self._pause_event.set()  # set means running, clear means paused

    @staticmethod
    def _generate_default_title(task_type: TaskType, payload: Dict[str, Any]) -> str:
        if task_type == TaskType.INDEX_FOLDERS:
            paths = payload.get("folder_paths", [])
            if len(paths) == 1:
                name = os.path.basename(os.path.normpath(paths[0])) or paths[0]
                return f"Index: {name}"
            return f"Index {len(paths)} Folders"
        elif task_type == TaskType.REINDEX_FOLDER:
            path = payload.get("folder_path", "")
            name = os.path.basename(os.path.normpath(path)) or path
            return f"Reindex: {name}"
        elif task_type == TaskType.BATCH_REINDEX:
            paths = payload.get("folder_paths", [])
            return f"Reindex {len(paths)} Folders"
        elif task_type == TaskType.REBUILD_VIDEO_THUMBNAILS:
            return "Rebuild Video Thumbnails"
        elif task_type == TaskType.PRUNE_DELETED:
            return "Prune Missing Files"
        elif task_type == TaskType.CLEAR_CACHE:
            target = payload.get("target", "all")
            return f"Clear {target.capitalize()} Cache"
        return str(task_type.value)

    def is_paused(self) -> bool:
        return not self._pause_event.is_set()

    def pause(self):
        self._pause_event.clear()
        if self.status == TaskStatus.RUNNING:
            self.status = TaskStatus.PAUSED

    def resume(self):
        self._pause_event.set()
        if self.status == TaskStatus.PAUSED:
            self.status = TaskStatus.RUNNING

    def check_paused_or_cancelled(self) -> bool:
        """Helper to be called in inner loops.
        Blocks while paused.
        Returns False if cancel was requested, True if execution should proceed.
        """
        while not self._pause_event.is_set():
            if self.cancel_requested:
                return False
            time.sleep(0.2)
        return not self.cancel_requested

    def update_progress(self, processed: int, total: int, current_item: str = ""):
        self.processed_count = processed
        self.total_count = total
        if total > 0:
            self.progress = round(min(100.0, max(0.0, (processed / total) * 100.0)), 1)
        else:
            self.progress = 0.0
        if current_item:
            self.current_item = current_item

    def add_error(self, error_msg: str):
        self.error_count += 1
        if len(self.errors) < 50:
            self.errors.append(error_msg)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value if hasattr(self.type, "value") else str(self.type),
            "title": self.title,
            "payload": self.payload,
            "model_id": self.model_id,
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "progress": self.progress,
            "current_item": self.current_item,
            "processed_count": self.processed_count,
            "total_count": self.total_count,
            "error_count": self.error_count,
            "errors": self.errors,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration": (
                round((self.completed_at or time.time()) - self.started_at, 1)
                if self.started_at
                else 0
            ),
            "is_paused": self.is_paused(),
            "cancel_requested": self.cancel_requested
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Task":
        task_type_str = d.get("type", "INDEX_FOLDERS")
        try:
            task_type = TaskType(task_type_str)
        except Exception:
            task_type = TaskType.INDEX_FOLDERS

        task = cls(
            task_type=task_type,
            payload=d.get("payload", {}),
            title=d.get("title", ""),
            task_id=d.get("id"),
            model_id=d.get("model_id")
        )
        status_str = d.get("status", "queued")
        try:
            task.status = TaskStatus(status_str)
        except Exception:
            task.status = TaskStatus.QUEUED

        task.progress = float(d.get("progress", 0.0))
        task.current_item = str(d.get("current_item", ""))
        task.processed_count = int(d.get("processed_count", 0))
        task.total_count = int(d.get("total_count", 0))
        task.error_count = int(d.get("error_count", 0))
        task.errors = list(d.get("errors", []))
        task.created_at = float(d.get("created_at", time.time()))
        task.started_at = d.get("started_at")
        task.completed_at = d.get("completed_at")
        task.cancel_requested = bool(d.get("cancel_requested", False))

        if d.get("is_paused", False) or task.status == TaskStatus.PAUSED:
            task.pause()
        else:
            task.resume()

        return task


class TaskQueueManager:
    def __init__(self, indexer=None, persistence_path: Optional[str] = None):
        self.indexer = indexer
        if persistence_path is not None:
            self.persistence_path = persistence_path
        else:
            data_dir = str(paths.DATA_DIR)
            os.makedirs(data_dir, exist_ok=True)
            self.persistence_path = os.path.join(data_dir, "task_queue.json")

        self.lock = threading.RLock()
        self.worker_state: WorkerState = WorkerState.RUNNING
        self.active_task: Optional[Task] = None
        self.pending_queue: List[Task] = []
        self.history: List[Task] = []
        self.max_history: int = 50

        self.current_model_id: Optional[str] = None
        self.model_mismatch_warning: Optional[Dict[str, Any]] = None

        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None

    def start(self):
        with self.lock:
            if self._worker_thread is None or not self._worker_thread.is_alive():
                self._stop_event.clear()
                self._worker_thread = threading.Thread(
                    target=self._worker_loop,
                    name="TaskQueueWorkerThread",
                    daemon=True
                )
                self._worker_thread.start()
                print("[TaskQueue] Background worker thread started.")

    def stop(self):
        with self.lock:
            self._stop_event.set()
            self._wake_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)
            print("[TaskQueue] Background worker thread stopped.")

    def _is_model_loaded(self) -> bool:
        if self.indexer and hasattr(self.indexer, "model_manager"):
            mm = self.indexer.model_manager
            if hasattr(mm, "model"):
                return mm.model is not None
            return bool(getattr(mm, "current_model_id", None) or getattr(mm, "active_model", None))
        return bool(self.current_model_id)

    def _get_active_model_id(self) -> Optional[str]:
        if self.indexer and hasattr(self.indexer, "model_manager"):
            mm = self.indexer.model_manager
            if hasattr(mm, "model") and mm.model is None:
                return None
            return getattr(mm, "current_model_id", None) or getattr(mm, "active_model", None)
        return self.current_model_id

    def _check_model_mismatch(self):
        """Checks if pending tasks expect a model different from the active model."""
        active_m = self._get_active_model_id()
        is_ready = self._is_model_loaded()

        if not active_m or not is_ready:
            # If no model is currently active/loaded, warn if tasks exist
            if self.pending_queue:
                queued_m = self.pending_queue[0].model_id or "unknown"
                self.model_mismatch_warning = {
                    "is_mismatch": True,
                    "queued_model": queued_m,
                    "active_model": None,
                    "mismatched_count": len(self.pending_queue),
                    "reason": "no_model_loaded"
                }
            else:
                self.model_mismatch_warning = None
            return

        mismatches = []
        for task in self.pending_queue:
            if task.model_id and task.model_id != active_m:
                mismatches.append({
                    "task_id": task.id,
                    "title": task.title,
                    "task_model": task.model_id,
                    "active_model": active_m
                })

        if mismatches:
            self.model_mismatch_warning = {
                "is_mismatch": True,
                "queued_model": mismatches[0]["task_model"],
                "active_model": active_m,
                "mismatched_count": len(mismatches),
                "reason": "model_difference"
            }
        else:
            self.model_mismatch_warning = None

    def save_to_disk(self):
        if not self.persistence_path:
            return
        with self.lock:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(self.persistence_path)), exist_ok=True)
                snapshot = {
                    "version": 1,
                    "worker_state": self.worker_state.value if hasattr(self.worker_state, "value") else str(self.worker_state),
                    "active_model_at_save": self._get_active_model_id(),
                    "active_task": self.active_task.to_dict() if self.active_task else None,
                    "pending_tasks": [t.to_dict() for t in self.pending_queue],
                    "history": [t.to_dict() for t in self.history[:self.max_history]]
                }
                tmp_path = f"{self.persistence_path}.tmp"
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump(snapshot, f, indent=2, ensure_ascii=False)
                os.replace(tmp_path, self.persistence_path)
            except Exception as e:
                print(f"[TaskQueue] Failed to save queue to {self.persistence_path}: {e}")

    def load_from_disk(self, current_active_model: Optional[str] = None):
        """Hydrate queue state from disk with crash recovery and model mismatch checks."""
        if current_active_model is not None:
            self.current_model_id = current_active_model
        elif self.indexer and hasattr(self.indexer, "model_manager"):
            mm = self.indexer.model_manager
            self.current_model_id = getattr(mm, "current_model_id", None) or getattr(mm, "active_model", None)

        target_path = self.persistence_path
        legacy_path = None
        if not target_path or not os.path.exists(target_path):
            legacy_path = os.path.join(str(paths.CACHE_DIR), "task_queue.json")
            if os.path.exists(legacy_path):
                target_path = legacy_path
            else:
                return

        with self.lock:
            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                saved_worker_state = data.get("worker_state", "running")
                raw_active_task = data.get("active_task")
                raw_pending = data.get("pending_tasks", [])
                raw_history = data.get("history", [])

                self.history = [Task.from_dict(d) for d in raw_history[:self.max_history]]
                self.pending_queue = [Task.from_dict(d) for d in raw_pending]

                interrupted_task = None
                if raw_active_task:
                    t = Task.from_dict(raw_active_task)
                    if t.status in (TaskStatus.RUNNING, TaskStatus.PAUSED, TaskStatus.QUEUED):
                        t.status = TaskStatus.QUEUED
                        interrupted_task = t

                # Also reset any task in pending queue that was marked RUNNING
                for idx, task in enumerate(self.pending_queue):
                    if task.status == TaskStatus.RUNNING:
                        task.status = TaskStatus.QUEUED
                        if not interrupted_task and idx == 0:
                            interrupted_task = task

                if interrupted_task:
                    # Place interrupted task as #1 in the queue (index 0)
                    existing_ids = [t.id for t in self.pending_queue]
                    if interrupted_task.id not in existing_ids:
                        self.pending_queue.insert(0, interrupted_task)
                    # The Startup Safety Rule: Pause global queue when recovering interrupted tasks
                    self.worker_state = WorkerState.PAUSED
                    print(f"[TaskQueue] Recovered interrupted task '{interrupted_task.title}' to queue position #1. Worker set to PAUSED.")
                elif saved_worker_state == "paused":
                    self.worker_state = WorkerState.PAUSED
                else:
                    self.worker_state = WorkerState.RUNNING

                self._check_model_mismatch()
                self.save_to_disk()
                if target_path == legacy_path:
                    try:
                        os.remove(legacy_path)
                    except Exception:
                        pass
                print(f"[TaskQueue] Successfully loaded persistent queue: {len(self.pending_queue)} pending, {len(self.history)} history.")
            except Exception as e:
                print(f"[TaskQueue] Failed to load queue from {self.persistence_path}: {e}")

    def enqueue(
        self,
        task_type: TaskType,
        payload: Dict[str, Any],
        title: str = "",
        priority: str = "bottom",
        model_id: Optional[str] = None
    ) -> Task:
        assigned_model = model_id or self._get_active_model_id()
        task = Task(task_type=task_type, payload=payload, title=title, model_id=assigned_model)
        with self.lock:
            if priority == "top":
                self.pending_queue.insert(0, task)
            else:
                self.pending_queue.append(task)
            self._check_model_mismatch()
            self.save_to_disk()
            self._wake_event.set()
        return task

    def is_folder_in_queue(self, folder_path: str) -> Optional[Dict[str, Any]]:
        """Check if a folder path is already in active task or pending queue."""
        normalized = os.path.abspath(os.path.normpath(folder_path)).lower()
        with self.lock:
            if self.active_task and self.active_task.status in (TaskStatus.RUNNING, TaskStatus.PAUSED):
                active_paths = [
                    os.path.abspath(os.path.normpath(p)).lower()
                    for p in self.active_task.payload.get("folder_paths", [])
                ]
                if self.active_task.payload.get("folder_path"):
                    active_paths.append(
                        os.path.abspath(os.path.normpath(self.active_task.payload["folder_path"])).lower()
                    )
                if normalized in active_paths:
                    return {
                        "is_active": True,
                        "task_id": self.active_task.id,
                        "title": self.active_task.title
                    }

            for idx, task in enumerate(self.pending_queue):
                task_paths = [
                    os.path.abspath(os.path.normpath(p)).lower()
                    for p in task.payload.get("folder_paths", [])
                ]
                if task.payload.get("folder_path"):
                    task_paths.append(
                        os.path.abspath(os.path.normpath(task.payload["folder_path"])).lower()
                    )
                if normalized in task_paths:
                    return {
                        "is_active": False,
                        "position": idx + 1,
                        "task_id": task.id,
                        "title": task.title
                    }
        return None

    def cancel_task(self, task_id: str) -> bool:
        with self.lock:
            # Check active task
            if self.active_task and self.active_task.id == task_id:
                self.active_task.cancel_requested = True
                self.active_task.status = TaskStatus.CANCELLED
                self.active_task.resume()  # unpause so it exits loop quickly
                if self.indexer:
                    self.indexer.cancel_indexing()
                self.save_to_disk()
                return True

            # Check pending queue
            for i, task in enumerate(self.pending_queue):
                if task.id == task_id:
                    task.status = TaskStatus.CANCELLED
                    task.completed_at = time.time()
                    self.pending_queue.pop(i)
                    self._add_to_history(task)
                    self._check_model_mismatch()
                    self.save_to_disk()
                    return True
        return False

    def pause_task(self, task_id: str) -> bool:
        with self.lock:
            if self.active_task and self.active_task.id == task_id:
                self.active_task.pause()
                self.save_to_disk()
                return True
        return False

    def resume_task(self, task_id: str) -> bool:
        with self.lock:
            if self.active_task and self.active_task.id == task_id:
                self.active_task.resume()
                self.save_to_disk()
                return True
        return False

    def control_worker(self, action: str, adopt_model: bool = False) -> Dict[str, Any]:
        with self.lock:
            active_m = self._get_active_model_id()
            is_ready = self._is_model_loaded()

            if action in ("start", "resume", "adopt_active_model"):
                has_model_dependent_tasks = any(
                    t.type in (TaskType.INDEX_FOLDERS, TaskType.REINDEX_FOLDER, TaskType.BATCH_REINDEX, TaskType.PRUNE_DELETED)
                    for t in self.pending_queue
                ) or (self.active_task and self.active_task.type in (TaskType.INDEX_FOLDERS, TaskType.REINDEX_FOLDER, TaskType.BATCH_REINDEX, TaskType.PRUNE_DELETED))

                if has_model_dependent_tasks and not is_ready:
                    self.worker_state = WorkerState.PAUSED
                    self._check_model_mismatch()
                    self.save_to_disk()
                    return {
                        "success": False,
                        "worker_state": self.worker_state.value,
                        "active_task_id": self.active_task.id if self.active_task else None,
                        "error": "No AI model loaded in memory. Please select and download/activate a model in Settings first.",
                        "model_mismatch": self.model_mismatch_warning
                    }

                if (adopt_model or action == "adopt_active_model") and active_m:
                    self.retarget_tasks_to_model(active_m)
                self.worker_state = WorkerState.RUNNING
                if self.active_task:
                    self.active_task.resume()
                self._wake_event.set()
            elif action == "pause_immediate":
                self.worker_state = WorkerState.PAUSED
                if self.active_task:
                    self.active_task.pause()
            elif action == "pause_after_current":
                if self.active_task and self.active_task.status == TaskStatus.RUNNING:
                    self.worker_state = WorkerState.STOPPING_AFTER_CURRENT
                else:
                    self.worker_state = WorkerState.PAUSED

            self._check_model_mismatch()
            self.save_to_disk()
            return {
                "success": True,
                "worker_state": self.worker_state.value,
                "active_task_id": self.active_task.id if self.active_task else None,
                "model_mismatch": self.model_mismatch_warning
            }

    def retarget_tasks_to_model(self, new_model_id: str):
        """Retarget all pending tasks to the newly selected/active model."""
        with self.lock:
            self.current_model_id = new_model_id
            for task in self.pending_queue:
                task.model_id = new_model_id
            if self.active_task:
                self.active_task.model_id = new_model_id
            self._check_model_mismatch()
            self.save_to_disk()

    def move_task(self, task_id: str, direction: str) -> bool:
        with self.lock:
            idx = -1
            for i, task in enumerate(self.pending_queue):
                if task.id == task_id:
                    idx = i
                    break
            if idx == -1:
                return False

            task = self.pending_queue.pop(idx)
            if direction == "top":
                self.pending_queue.insert(0, task)
            elif direction == "bottom":
                self.pending_queue.append(task)
            elif direction == "up":
                new_idx = max(0, idx - 1)
                self.pending_queue.insert(new_idx, task)
            elif direction == "down":
                new_idx = min(len(self.pending_queue), idx + 1)
                self.pending_queue.insert(new_idx, task)
            else:
                self.pending_queue.insert(idx, task)
                return False
            self.save_to_disk()
            return True

    def reorder_tasks(self, task_ids: List[str]) -> bool:
        with self.lock:
            id_to_task = {task.id: task for task in self.pending_queue}
            new_queue = []
            for tid in task_ids:
                if tid in id_to_task:
                    new_queue.append(id_to_task.pop(tid))
            # Append any tasks that were not in the provided list
            for remaining_task in id_to_task.values():
                new_queue.append(remaining_task)
            self.pending_queue = new_queue
            self.save_to_disk()
            return True

    def retry_task(self, task_id: str) -> Optional[Task]:
        with self.lock:
            target = None
            for task in self.history:
                if task.id == task_id:
                    target = task
                    break
            if not target:
                return None

            new_task = Task(
                task_type=target.type,
                payload=dict(target.payload),
                title=target.title,
                model_id=self._get_active_model_id()
            )
            self.pending_queue.append(new_task)
            self._check_model_mismatch()
            self.save_to_disk()
            self._wake_event.set()
            return new_task

    def clear_history(self) -> int:
        with self.lock:
            count = len(self.history)
            self.history.clear()
            self.save_to_disk()
            return count

    def _add_to_history(self, task: Task):
        self.history.insert(0, task)
        if len(self.history) > self.max_history:
            self.history.pop()

    def get_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            self._check_model_mismatch()
            active_m = self._get_active_model_id()
            return {
                "worker_state": self.worker_state.value,
                "active_task": self.active_task.to_dict() if self.active_task else None,
                "pending_tasks": [t.to_dict() for t in self.pending_queue],
                "history": [t.to_dict() for t in self.history],
                "pending_count": len(self.pending_queue),
                "history_count": len(self.history),
                "model_mismatch": self.model_mismatch_warning,
                "active_model": active_m
            }

    def _worker_loop(self):
        while not self._stop_event.is_set():
            task_to_run = None
            with self.lock:
                if self.worker_state != WorkerState.PAUSED and self.active_task is None:
                    if self.pending_queue:
                        next_task = self.pending_queue[0]
                        requires_model = next_task.type in (
                            TaskType.INDEX_FOLDERS,
                            TaskType.REINDEX_FOLDER,
                            TaskType.BATCH_REINDEX,
                            TaskType.PRUNE_DELETED,
                        )
                        if requires_model and not self._is_model_loaded():
                            print(f"[TaskQueue] Cannot run task {next_task.id}: No AI model loaded in memory. Pausing worker.")
                            self.worker_state = WorkerState.PAUSED
                            self._check_model_mismatch()
                            self.save_to_disk()
                        else:
                            task_to_run = self.pending_queue.pop(0)
                            self.active_task = task_to_run
                            task_to_run.status = TaskStatus.RUNNING
                            task_to_run.started_at = time.time()
                            task_to_run.resume()
                            self.save_to_disk()

            if task_to_run:
                self._execute_task(task_to_run)
                with self.lock:
                    task_to_run.completed_at = time.time()
                    if task_to_run.cancel_requested:
                        task_to_run.status = TaskStatus.CANCELLED
                    elif task_to_run.error_count > 0 and task_to_run.processed_count == 0:
                        task_to_run.status = TaskStatus.FAILED
                    else:
                        task_to_run.status = TaskStatus.COMPLETED

                    self._add_to_history(task_to_run)
                    self.active_task = None

                    if self.worker_state == WorkerState.STOPPING_AFTER_CURRENT:
                        self.worker_state = WorkerState.PAUSED

                    self._check_model_mismatch()
                    self.save_to_disk()
            else:
                self._wake_event.wait(timeout=0.5)
                self._wake_event.clear()

    def _execute_task(self, task: Task):
        if not self.indexer:
            task.add_error("Indexer engine is not initialized.")
            return

        try:
            print(f"[TaskQueue] Starting task {task.id} ({task.type.value}): '{task.title}'")
            if task.type == TaskType.INDEX_FOLDERS:
                folder_paths = task.payload.get("folder_paths", [])
                self.indexer.batch_index_folders(folder_paths, task_context=task)
            elif task.type == TaskType.REINDEX_FOLDER:
                folder_path = task.payload.get("folder_path", "")
                if hasattr(self.indexer, "reindex_folder"):
                    self.indexer.reindex_folder(folder_path, task_context=task)
                else:
                    self.indexer.reindex_directory(folder_path, task_context=task)
            elif task.type == TaskType.BATCH_REINDEX:
                folder_paths = task.payload.get("folder_paths", [])
                self.indexer.batch_reindex_folders(folder_paths, task_context=task)
            elif task.type == TaskType.REBUILD_VIDEO_THUMBNAILS:
                self.indexer.regenerate_video_thumbnails(task_context=task)
            elif task.type == TaskType.PRUNE_DELETED:
                if hasattr(self.indexer, "prune_deleted_files"):
                    self.indexer.prune_deleted_files(task_context=task)
            elif task.type == TaskType.CLEAR_CACHE:
                from indexer import safe_clear_cache
                target = task.payload.get("target", "all")
                safe_clear_cache(target=target)
                task.update_progress(1, 1, f"Cleared {target} cache")
            else:
                task.add_error(f"Unsupported task type: {task.type}")
        except Exception as e:
            print(f"[TaskQueue] Task {task.id} execution error: {e}")
            task.add_error(str(e))
