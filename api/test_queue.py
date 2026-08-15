import time
import os
import unittest
from task_queue import TaskQueueManager, Task, TaskType, TaskStatus, WorkerState


class DummyIndexer:
    def __init__(self):
        self.is_indexing = False
        self.is_rebuilding_video_thumbnails = False
        self.execution_log = []

    def batch_index_folders(self, folder_paths, task_context=None):
        self.is_indexing = True
        self.execution_log.append(f"batch_index:{folder_paths}")
        total = 10
        for i in range(1, total + 1):
            if task_context and not task_context.check_paused_or_cancelled():
                break
            time.sleep(0.02)
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
        self.indexer = DummyIndexer()
        self.queue_mgr = TaskQueueManager(self.indexer)

    def tearDown(self):
        self.queue_mgr.stop()

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


if __name__ == "__main__":
    unittest.main()
