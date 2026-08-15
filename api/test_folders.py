import unittest
import os
import shutil
import tempfile
from unittest.mock import MagicMock
from indexer import Indexer

class DummyModelManager:
    def __init__(self):
        self.current_model_id = "test-model"
        self.use_gpu = False
        self.is_downloading = False
        self.download_total_bytes = 0
        self.download_current_bytes = 0
        self.download_speed = 0
        self.download_eta = 0
        self.download_error = None
        self.cancel_download = False
        self.is_loading_model = False
        self.oom_triggered = False

    def get_collection_name(self):
        return "test_collection"

    def get_image_embeddings_batch(self, images, task_context=None):
        return [[0.1] * 128 for _ in images]

    def get_text_embedding(self, text):
        return [0.1] * 128


class TestHierarchicalIndexedFolders(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="vblis_test_")
        self.db_dir = os.path.join(self.test_dir, "chroma_db")
        self.model_mgr = DummyModelManager()
        self.indexer = Indexer(self.model_mgr, db_path=self.db_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_hierarchical_structure_and_counts(self):
        root_dir = os.path.join(self.test_dir, "Photos")
        sub1 = os.path.join(root_dir, "2024_Trip")
        sub2 = os.path.join(root_dir, "2023_Family")
        os.makedirs(sub1, exist_ok=True)
        os.makedirs(sub2, exist_ok=True)

        # Mock collection data in indexer
        self.indexer._add_selected_folder(root_dir)
        
        # Add records to chroma collection
        self.indexer.collection.add(
            ids=["img1", "img2", "img3", "vid1"],
            embeddings=[[0.1]*128]*4,
            metadatas=[
                {"path": os.path.join(sub1, "photo1.jpg"), "media_type": "image"},
                {"path": os.path.join(sub1, "photo2.jpg"), "media_type": "image"},
                {"path": os.path.join(sub2, "family.jpg"), "media_type": "image"},
                {"path": os.path.join(root_dir, "clip.mp4"), "media_type": "video"},
            ]
        )

        folders = self.indexer.get_indexed_folders()
        self.assertEqual(len(folders), 1)

        parent = folders[0]
        self.assertEqual(parent["name"], "Photos")
        self.assertEqual(parent["item_count"], 4)
        self.assertEqual(parent["image_count"], 3)
        self.assertEqual(parent["video_count"], 1)
        self.assertEqual(parent["subfolder_count"], 2)

        # Verify subfolders
        subfolder_names = [s["name"] for s in parent["subfolders"]]
        self.assertIn("2024_Trip", subfolder_names)
        self.assertIn("2023_Family", subfolder_names)

        trip_sub = next(s for s in parent["subfolders"] if s["name"] == "2024_Trip")
        self.assertEqual(trip_sub["image_count"], 2)
        self.assertEqual(trip_sub["item_count"], 2)

    def test_single_subfolder_deletion(self):
        root_dir = os.path.join(self.test_dir, "Album")
        sub1 = os.path.join(root_dir, "FolderA")
        sub2 = os.path.join(root_dir, "FolderB")
        os.makedirs(sub1, exist_ok=True)
        os.makedirs(sub2, exist_ok=True)

        self.indexer._add_selected_folder(root_dir)
        self.indexer.collection.add(
            ids=["a1", "b1", "b2"],
            embeddings=[[0.1]*128]*3,
            metadatas=[
                {"path": os.path.join(sub1, "a.jpg"), "media_type": "image"},
                {"path": os.path.join(sub2, "b1.jpg"), "media_type": "image"},
                {"path": os.path.join(sub2, "b2.jpg"), "media_type": "image"},
            ]
        )

        # Delete sub2 only
        deleted = self.indexer.delete_folder_index(sub2)
        self.assertEqual(deleted, 2)

        # Verify parent still exists and now only contains sub1
        folders = self.indexer.get_indexed_folders()
        self.assertEqual(len(folders), 1)
        parent = folders[0]
        self.assertEqual(parent["name"], "Album")
        self.assertEqual(parent["item_count"], 1)
        self.assertEqual(parent["subfolder_count"], 1)
        self.assertEqual(parent["subfolders"][0]["name"], "FolderA")


if __name__ == "__main__":
    unittest.main()
