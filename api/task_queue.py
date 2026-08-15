import os
import time
import uuid
import threading
from enum import Enum
from typing import Optional, List, Dict, Any


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
        task_id: Optional[str] = None
    ):
        self.id: str = task_id or str(uuid.uuid4())
        self.type: TaskType = task_type
        self.title: str = title or self._generate_default_title(task_type, payload)
        self.payload: Dict[str, Any] = payload
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


class TaskQueueManager:
    def __init__(self, indexer=None):
        self.indexer = indexer
        self.lock = threading.RLock()
        self.worker_state: WorkerState = WorkerState.RUNNING
        self.active_task: Optional[Task] = None
        self.pending_queue: List[Task] = []
        self.history: List[Task] = []
        self.max_history: int = 50

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
        self._stop_event.set()
        self._wake_event.set()
        with self.lock:
            if self.active_task:
                self.active_task.cancel_requested = True
                self.active_task.resume()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)
            print("[TaskQueue] Background worker thread stopped.")

    def enqueue(
        self,
        task_type: TaskType,
        payload: Dict[str, Any],
        title: str = "",
        priority: str = "bottom"
    ) -> Task:
        task = Task(task_type=task_type, payload=payload, title=title)
        with self.lock:
            if priority == "top":
                self.pending_queue.insert(0, task)
            else:
                self.pending_queue.append(task)
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
                return True

            # Check pending queue
            for i, task in enumerate(self.pending_queue):
                if task.id == task_id:
                    task.status = TaskStatus.CANCELLED
                    task.completed_at = time.time()
                    self.pending_queue.pop(i)
                    self._add_to_history(task)
                    return True
        return False

    def pause_task(self, task_id: str) -> bool:
        with self.lock:
            if self.active_task and self.active_task.id == task_id:
                self.active_task.pause()
                return True
        return False

    def resume_task(self, task_id: str) -> bool:
        with self.lock:
            if self.active_task and self.active_task.id == task_id:
                self.active_task.resume()
                return True
        return False

    def control_worker(self, action: str) -> Dict[str, Any]:
        with self.lock:
            if action == "start":
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
            return {
                "worker_state": self.worker_state.value,
                "active_task_id": self.active_task.id if self.active_task else None
            }

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
                title=target.title
            )
            self.pending_queue.append(new_task)
            self._wake_event.set()
            return new_task

    def clear_history(self) -> int:
        with self.lock:
            count = len(self.history)
            self.history.clear()
            return count

    def _add_to_history(self, task: Task):
        self.history.insert(0, task)
        if len(self.history) > self.max_history:
            self.history.pop()

    def get_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "worker_state": self.worker_state.value,
                "active_task": self.active_task.to_dict() if self.active_task else None,
                "pending_tasks": [t.to_dict() for t in self.pending_queue],
                "history": [t.to_dict() for t in self.history],
                "pending_count": len(self.pending_queue),
                "history_count": len(self.history)
            }

    def _worker_loop(self):
        while not self._stop_event.is_set():
            task_to_run = None
            with self.lock:
                if self.worker_state != WorkerState.PAUSED and self.active_task is None:
                    if self.pending_queue:
                        task_to_run = self.pending_queue.pop(0)
                        self.active_task = task_to_run
                        task_to_run.status = TaskStatus.RUNNING
                        task_to_run.started_at = time.time()
                        task_to_run.resume()

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
                from .indexer import safe_clear_cache
                target = task.payload.get("target", "all")
                safe_clear_cache(target=target)
                task.update_progress(1, 1, f"Cleared {target} cache")
            else:
                task.add_error(f"Unsupported task type: {task.type}")
        except Exception as e:
            print(f"[TaskQueue] Task {task.id} execution error: {e}")
            task.add_error(str(e))
