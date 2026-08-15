import time
import os
import shutil
import tempfile
import unittest
from task_queue import TaskQueueManager, Task, TaskType, TaskStatus, WorkerState


class DummyModelManager:
    def __init__(self, active_model="google/siglip2-base-patch16-224"):
        self.active_model = active_model


class DummyIndexer:
    def __init__(self, active_model="google/siglip2-base-patch16-224"):
        self.is_indexing = False
        self.is_rebuilding_video_thumbnails = False
        self.execution_log = []
        self.model_manager = DummyModelManager(active_model)

    def batch_index_folders(self, folder_paths, task_context=None):
        self.is_indexing = True
        self.execution_log.append(f"batch_index:{folder_paths}")
        total = 10
        for i in range(1, total + 1):
            if task_context and not task_context.check_paused_or_cancelled():
                break
            time.sleep(0.01)
            if task_context:
                task_context.update_progress(i, total, f"item_{i}.jpg")
        self.is_indexing = False

    def reindex_folder(self, folder_path, task_context=None):
        self.is_indexing = True
        self.execution_log.append(f"reindex:{folder_path}")
        if task_context:
            task_context.update_progress(1, 1, folder_path)
        self.is_indexing = False

    def regenerate_video_thumbnails(self, task_context=None):
        self.is_rebuilding_video_thumbnails = True
        self.execution_log.append("regenerate_video_thumbnails")
        if task_context:
            task_context.update_progress(5, 5, "video_frames")
        self.is_rebuilding_video_thumbnails = False

    def cancel_indexing(self):
        pass


class TestTaskQueue(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="vblis_queue_test_")
        self.persistence_path = os.path.join(self.test_dir, "test_task_queue.json")
        self.indexer = DummyIndexer(active_model="google/siglip2-base-patch16-224")
        self.queue_mgr = TaskQueueManager(self.indexer, persistence_path=self.persistence_path)

    def tearDown(self):
        self.queue_mgr.stop()
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_enqueue_and_priority(self):
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/a"]}, priority="bottom")
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/b"]}, priority="bottom")
        t3 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/c"]}, priority="top")

        self.assertEqual(len(self.queue_mgr.pending_queue), 3)
        self.assertEqual(self.queue_mgr.pending_queue[0].id, t3.id)
        self.assertEqual(self.queue_mgr.pending_queue[1].id, t1.id)
        self.assertEqual(self.queue_mgr.pending_queue[2].id, t2.id)

    def test_move_task(self):
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/1"]})
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/2"]})
        t3 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/3"]})

        # Move t3 up
        self.assertTrue(self.queue_mgr.move_task(t3.id, "up"))
        self.assertEqual([t.id for t in self.queue_mgr.pending_queue], [t1.id, t3.id, t2.id])

        # Move t2 top
        self.assertTrue(self.queue_mgr.move_task(t2.id, "top"))
        self.assertEqual([t.id for t in self.queue_mgr.pending_queue], [t2.id, t1.id, t3.id])

        # Move t2 down
        self.assertTrue(self.queue_mgr.move_task(t2.id, "down"))
        self.assertEqual([t.id for t in self.queue_mgr.pending_queue], [t1.id, t2.id, t3.id])

    def test_reorder_tasks(self):
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/1"]})
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/2"]})
        t3 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/3"]})

        # Reorder to [t3, t1, t2]
        self.assertTrue(self.queue_mgr.reorder_tasks([t3.id, t1.id, t2.id]))
        self.assertEqual([t.id for t in self.queue_mgr.pending_queue], [t3.id, t1.id, t2.id])

    def test_cancel_pending_task(self):
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/1"]})
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/2"]})

        self.assertTrue(self.queue_mgr.cancel_task(t1.id))
        self.assertEqual(len(self.queue_mgr.pending_queue), 1)
        self.assertEqual(len(self.queue_mgr.history), 1)
        self.assertEqual(self.queue_mgr.history[0].status, TaskStatus.CANCELLED)

    def test_retry_task(self):
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/1"]})
        self.queue_mgr.cancel_task(t1.id)

        retried = self.queue_mgr.retry_task(t1.id)
        self.assertIsNotNone(retried)
        self.assertEqual(retried.type, TaskType.INDEX_FOLDERS)
        self.assertEqual(retried.payload, {"folder_paths": ["/path/1"]})
        self.assertEqual(len(self.queue_mgr.pending_queue), 1)

    def test_worker_execution(self):
        self.queue_mgr.start()
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/test/folder1"]})

        # Wait for task to finish
        for _ in range(50):
            snap = self.queue_mgr.get_snapshot()
            if snap["history_count"] > 0:
                break
            time.sleep(0.05)

        snap = self.queue_mgr.get_snapshot()
        self.assertEqual(snap["history_count"], 1)
        self.assertEqual(snap["history"][0]["status"], TaskStatus.COMPLETED)
        self.assertEqual(snap["history"][0]["progress"], 100.0)
        self.assertIn("batch_index:['/test/folder1']", self.indexer.execution_log)

    def test_duplicate_folder_check(self):
        self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["D:/MyPhotos"]})
        dup = self.queue_mgr.is_folder_in_queue("D:/MyPhotos")
        self.assertIsNotNone(dup)
        self.assertEqual(dup["position"], 1)

        dup_slash = self.queue_mgr.is_folder_in_queue("D:\\MyPhotos")
        self.assertIsNotNone(dup_slash)

        non_dup = self.queue_mgr.is_folder_in_queue("D:/OtherPhotos")
        self.assertIsNone(non_dup)

    def test_global_worker_pause_and_resume(self):
        self.queue_mgr.control_worker("pause_immediate")
        self.assertEqual(self.queue_mgr.worker_state, WorkerState.PAUSED)
        self.queue_mgr.start()

        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/paused/folder"]})
        time.sleep(0.1)

        # Worker is paused so task should still be pending
        snap = self.queue_mgr.get_snapshot()
        self.assertEqual(snap["pending_count"], 1)
        self.assertIsNone(snap["active_task"])

        # Resume worker
        self.queue_mgr.control_worker("start")
        for _ in range(50):
            snap = self.queue_mgr.get_snapshot()
            if snap["history_count"] > 0:
                break
            time.sleep(0.05)

        snap = self.queue_mgr.get_snapshot()
        self.assertEqual(snap["history_count"], 1)
        self.assertEqual(snap["history"][0]["status"], TaskStatus.COMPLETED)

    def test_json_persistence_and_reload(self):
        """Verify tasks, ordering, and history persist across TaskQueueManager instances."""
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/alpha"]})
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/beta"]})
        self.queue_mgr.cancel_task(t1.id)  # moves t1 to history

        # Add a 3rd task
        t3 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/gamma"]})

        self.queue_mgr.stop()
        self.assertTrue(os.path.exists(self.persistence_path))

        # Create a new manager pointing to the same persistence file
        new_mgr = TaskQueueManager(self.indexer, persistence_path=self.persistence_path)
        new_mgr.load_from_disk(current_active_model="google/siglip2-base-patch16-224")

        snap = new_mgr.get_snapshot()
        self.assertEqual(snap["pending_count"], 2)
        self.assertEqual([t["id"] for t in snap["pending_tasks"]], [t2.id, t3.id])
        self.assertEqual(snap["history_count"], 1)
        self.assertEqual(snap["history"][0]["id"], t1.id)
        new_mgr.stop()

    def test_interrupted_task_recovery_to_position_one_and_paused(self):
        """Verify in-flight running task is recovered at index 0 and worker starts paused."""
        t1 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/first"]})
        t2 = self.queue_mgr.enqueue(TaskType.INDEX_FOLDERS, {"folder_paths": ["/path/second"]})

        # Simulate task 1 became active and was running when server terminated
        self.queue_mgr.pending_queue.pop(0)
        t1.status = TaskStatus.RUNNING
        t1.update_progress(4, 10, "item_4.jpg")
        self.queue_mgr.active_task = t1
        self.queue_mgr.worker_state = WorkerState.RUNNING
        self.queue_mgr.save_to_disk()

        # Re-instantiate manager simulating app restart
        new_mgr = TaskQueueManager(self.indexer, persistence_path=self.persistence_path)
        new_mgr.load_from_disk(current_active_model="google/siglip2-base-patch16-224")

        snap = new_mgr.get_snapshot()
        # Task 1 must be recovered as item #0 with status='queued'
        self.assertEqual(snap["pending_count"], 2)
        self.assertEqual(snap["pending_tasks"][0]["id"], t1.id)
        self.assertEqual(snap["pending_tasks"][0]["status"], "queued")
        self.assertEqual(snap["pending_tasks"][1]["id"], t2.id)
        # Global worker must be PAUSED
        self.assertEqual(snap["worker_state"], "paused")
        self.assertIsNone(snap["active_task"])
        new_mgr.stop()

    def test_model_mismatch_and_adopt_active_model(self):
        """Verify detection of mismatched models on restart and user adoption via control_worker."""
        # Queue task with Model A
        t1 = self.queue_mgr.enqueue(
            TaskType.INDEX_FOLDERS,
            {"folder_paths": ["/path/model_a_folder"]},
            model_id="google/siglip2-base-patch16-224"
        )
        self.queue_mgr.stop()

        # Restart backend with Model B active
        new_indexer = DummyIndexer(active_model="openai/clip-vit-base-patch32")
        new_mgr = TaskQueueManager(new_indexer, persistence_path=self.persistence_path)
        new_mgr.load_from_disk(current_active_model="openai/clip-vit-base-patch32")

        snap = new_mgr.get_snapshot()
        self.assertIsNotNone(snap["model_mismatch"])
        self.assertTrue(snap["model_mismatch"]["is_mismatch"])
        self.assertEqual(snap["model_mismatch"]["queued_model"], "google/siglip2-base-patch16-224")
        self.assertEqual(snap["model_mismatch"]["active_model"], "openai/clip-vit-base-patch32")

        # User chooses to proceed with active Model B
        res = new_mgr.control_worker("adopt_active_model")
        self.assertEqual(new_mgr.worker_state, WorkerState.RUNNING)

        snap_after = new_mgr.get_snapshot()
        self.assertIsNone(snap_after["model_mismatch"])
        self.assertEqual(snap_after["pending_tasks"][0]["model_id"], "openai/clip-vit-base-patch32")
        new_mgr.stop()

    def test_missing_model_blocks_start_until_loaded(self):
        """Verify that starting the queue with no model loaded fails gracefully and keeps queue paused."""
        # Enqueue an index task
        t1 = self.queue_mgr.enqueue(
            TaskType.INDEX_FOLDERS,
            {"folder_paths": ["/path/test_folder"]},
            model_id="google/siglip2-base-patch16-224"
        )
        self.queue_mgr.stop()

        # Simulate startup with NO model loaded (e.g. model deleted or None)
        no_model_indexer = DummyIndexer(active_model=None)
        no_model_mgr = TaskQueueManager(no_model_indexer, persistence_path=self.persistence_path)
        no_model_mgr.load_from_disk(current_active_model=None)

        snap = no_model_mgr.get_snapshot()
        self.assertIsNotNone(snap["model_mismatch"])
        self.assertEqual(snap["model_mismatch"]["reason"], "no_model_loaded")

        # Attempt to start the worker - MUST return success=False and remain PAUSED
        res = no_model_mgr.control_worker("start")
        self.assertFalse(res.get("success"))
        self.assertIn("No AI model loaded", res.get("error", ""))
        self.assertEqual(no_model_mgr.worker_state, WorkerState.PAUSED)
        self.assertEqual(len(no_model_mgr.pending_queue), 1)
        self.assertIsNone(no_model_mgr.active_task)

        # Now simulate model being loaded
        no_model_indexer.model_manager.active_model = "google/siglip2-base-patch16-224"
        no_model_mgr.current_model_id = "google/siglip2-base-patch16-224"

        # Now start worker - should succeed
        res_ok = no_model_mgr.control_worker("start")
        self.assertTrue(res_ok.get("success"))
        self.assertEqual(no_model_mgr.worker_state, WorkerState.RUNNING)
        no_model_mgr.stop()

    def test_download_model_matching_vs_differing_queued_model(self):
        """Verify that downloading a different model does not auto-switch/retarget tasks for a missing model."""
        # Queue task for Model A
        t1 = self.queue_mgr.enqueue(
            TaskType.INDEX_FOLDERS,
            {"folder_paths": ["/path/folder"]},
            model_id="google/siglip2-base-patch16-224"
        )
        self.queue_mgr.stop()

        # No model active
        indexer = DummyIndexer(active_model=None)
        mgr = TaskQueueManager(indexer, persistence_path=self.persistence_path)
        mgr.load_from_disk(current_active_model=None)

        queued_model_ids = {t.model_id for t in mgr.pending_queue if t.model_id}
        self.assertEqual(queued_model_ids, {"google/siglip2-base-patch16-224"})

        # Case 1: Download Model B ("openai/clip-vit-base-patch32")
        downloaded_model_b = "openai/clip-vit-base-patch32"
        is_model_active = indexer.model_manager.active_model is not None
        matches_all = bool(queued_model_ids and queued_model_ids == {downloaded_model_b})
        should_auto_activate_b = not is_model_active and matches_all
        self.assertFalse(should_auto_activate_b)  # MUST NOT auto-activate

        # Case 2: Download Model A ("google/siglip2-base-patch16-224")
        downloaded_model_a = "google/siglip2-base-patch16-224"
        matches_all_a = bool(queued_model_ids and queued_model_ids == {downloaded_model_a})
        should_auto_activate_a = not is_model_active and matches_all_a
        self.assertTrue(should_auto_activate_a)  # SHOULD auto-activate matching model

        mgr.stop()


if __name__ == "__main__":
    unittest.main()
