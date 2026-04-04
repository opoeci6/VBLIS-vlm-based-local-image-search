import os
import hashlib
from PIL import Image
import pillow_heif
import chromadb
import sqlite3
from model_manager import ModelManager

pillow_heif.register_heif_opener()

def compute_file_hash(filepath, chunk_size=8192):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()

class Indexer:
    def __init__(self, model_manager: ModelManager, db_path=None):
        if db_path is None:
            # Always put the db relative to this python file inside the api folder
            db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_data")
            
        self.model_manager = model_manager
        self.client = chromadb.PersistentClient(path=db_path)
        self.collection = None
        
        # Connect to the collection matching the loaded VLM
        if self.model_manager.current_model_id:
            self.switch_collection(self.model_manager.get_collection_name())
            
        self.is_indexing = False
        self.total_files = 0
        self.indexed_files = 0
        self.current_file = ""
        self.error_count = 0
        self.failed_files = []
        self.last_task_id = 0

        
    def switch_collection(self, collection_name: str):
        print(f"Switching to Chroma collection: {collection_name}")
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        
    def _ensure_collection(self):
        """Ensure the collection is initialized before use."""
        if not self.collection and self.model_manager.current_model_id:
            self.switch_collection(self.model_manager.get_collection_name())
        return self.collection is not None

    def clear_collection(self):
        """Wipe all data from the active collection."""
        if self.collection:
            collection_name = self.collection.name
            print(f"Clearing collection: {collection_name}")
            self.client.delete_collection(name=collection_name)
            self.switch_collection(collection_name)
            self.run_maintenance()

    def delete_collection(self, collection_name: str):
        """Permanently delete a collection and its data."""
        print(f"Deleting Chroma collection: {collection_name}")
        try:
            self.client.delete_collection(name=collection_name)
            # If we just deleted the active collection, reset it
            if self.collection and self.collection.name == collection_name:
                self.collection = None
            self.run_maintenance()
        except Exception as e:
            print(f"Error deleting collection {collection_name}: {e}")

    def get_indexed_folders(self):
        """Get a list of unique parent directories that are currently indexed with existence status."""
        if not self._ensure_collection():
            return []
        
        try:
            results = self.collection.get(include=["metadatas"])
            folders_map = {}
            for meta in results["metadatas"]:
                if meta and "path" in meta:
                    parent = os.path.dirname(meta["path"])
                    if parent not in folders_map:
                        # Check if it's a directory
                        folders_map[parent] = os.path.isdir(parent)
            
            # Return as list of dictionaries
            output = [{"path": p, "exists": e} for p, e in folders_map.items()]
            return sorted(output, key=lambda x: x["path"])
        except Exception as e:
            print(f"Error getting indexed folders: {e}")
            return []

    def delete_folder_index(self, folder_path: str):
        """Delete all index entries belonging to a specific folder."""
        if not self._ensure_collection():
            return 0
            
        try:
            # We want to delete all files that are in this folder or its subfolders
            # Normalizing folder_path to ensure correct matching
            norm_folder = os.path.normpath(folder_path)
            
            results = self.collection.get(include=["metadatas"])
            ids_to_delete = []
            
            for i, meta in enumerate(results["metadatas"]):
                if meta and "path" in meta:
                    file_path = os.path.normpath(meta["path"])
                    if file_path == norm_folder or file_path.startswith(norm_folder + os.sep):
                        ids_to_delete.append(results["ids"][i])
            
            if ids_to_delete:
                print(f"Deleting {len(ids_to_delete)} entries for folder: {folder_path}")
                self.collection.delete(ids=ids_to_delete)
                self.run_maintenance()
                return len(ids_to_delete)
            return 0
        except Exception as e:
            print(f"Error deleting folder index: {e}")
            raise e
            
    def get_status(self):
        return {
            "is_indexing": self.is_indexing,
            "progress": f"{self.indexed_files}/{self.total_files}" if self.total_files > 0 else "0/0",
            "percent": (self.indexed_files / self.total_files * 100) if self.total_files > 0 else 0,
            "current_file": self.current_file,
            "errors": self.error_count,
            "failed_files": self.failed_files,
            "last_task_id": self.last_task_id,
            "is_downloading": self.model_manager.is_downloading,
            "download_total_bytes": self.model_manager.download_total_bytes,
            "download_current_bytes": self.model_manager.download_current_bytes,
            "download_speed": self.model_manager.download_speed,
            "download_eta": self.model_manager.download_eta,
            "download_error": self.model_manager.download_error,
            "cancel_download": self.model_manager.cancel_download,
            "is_loading_model": self.model_manager.is_loading_model
        }



    def index_directory(self, directory: str):
        self.batch_index_folders([directory])

    def batch_index_folders(self, folder_paths: list[str]):
        if self.is_indexing:
            return  # Prevent concurrent indexing
            
        self.is_indexing = True
        self.error_count = 0
        self.indexed_files = 0
        
        # Ensure collection is set
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        self.failed_files = []
        
        try:
            valid_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic"}
            files_to_index = []
            
            for directory in folder_paths:
                if not os.path.isdir(directory):
                    print(f"[Warning] Indexer: Skipping invalid directory {directory}")
                    continue
                for root, _, files in os.walk(directory):
                    for file in files:
                        if os.path.splitext(file)[1].lower() in valid_extensions:
                            files_to_index.append(os.path.join(root, file))
            
            self.total_files = len(files_to_index)
            
            # Get existing IDs (paths) to avoid redundant work
            existing_results = self.collection.get(include=[])
            existing_ids = set(existing_results["ids"]) if existing_results and "ids" in existing_results else set()
            
            for filepath in files_to_index:
                self.current_file = filepath
                
                try:
                    if filepath in existing_ids:
                        self.indexed_files += 1
                        continue
                        
                    file_hash = compute_file_hash(filepath)
                    
                    # Try to reuse existing embedding for the same content
                    existing_entries = self.collection.get(
                        where={"hash": file_hash},
                        include=["embeddings"],
                        limit=1
                    )
                    
                    if existing_entries.get("embeddings") is not None and len(existing_entries["embeddings"]) > 0:
                        embedding = existing_entries["embeddings"][0]
                    else:
                        # Process image
                        image = Image.open(filepath)
                        embedding = self.model_manager.get_image_embedding(image)
                    
                    self.collection.add(
                        embeddings=[embedding],
                        metadatas=[{"path": filepath, "hash": file_hash}],
                        ids=[filepath]
                    )
                    
                    existing_ids.add(filepath)
                    
                except Exception as e:
                    print(f"Error indexing {filepath}: {e}")
                    self.error_count += 1
                    self.failed_files.append(filepath)
                
                self.indexed_files += 1
                
        finally:
            self.is_indexing = False
            self.current_file = ""
            self.last_task_id += 1

    def reindex_directory(self, directory: str):
        """Synchronize the index with the current state of a directory.
        Adds new/changed files, removes files no longer on disk.
        """
        if self.is_indexing:
            return
            
        if not os.path.isdir(directory):
            print(f"[Error] Cannot reindex: Directory '{directory}' not found.")
            return

        self.is_indexing = True
        self.error_count = 0
        self.indexed_files = 0
        
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        self.failed_files = []
        
        try:
            valid_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic"}
            norm_target = os.path.normpath(directory)
            
            # 1. Get current files on disk
            disk_files = []
            for root, _, files in os.walk(directory):
                for file in files:
                    if os.path.splitext(file)[1].lower() in valid_extensions:
                        disk_files.append(os.path.normpath(os.path.join(root, file)))
            
            # 2. Get current files in index for this directory
            results = self.collection.get(include=["metadatas"])
            db_entries = [] # List of (id, path, hash)
            for i, meta in enumerate(results["metadatas"]):
                if meta and "path" in meta:
                    db_path = os.path.normpath(meta["path"])
                    if db_path == norm_target or db_path.startswith(norm_target + os.sep):
                        db_entries.append({
                            "id": results["ids"][i], # id is now path
                            "path": db_path,
                            "hash": meta.get("hash")
                        })
            
            db_paths = {e["path"] for e in db_entries}
            db_hashes_by_path = {e["path"]: e["hash"] for e in db_entries}
            
            self.total_files = len(disk_files) + len(db_paths)
            
            # 3. Remove entries from DB that are no longer on disk
            ids_to_remove = []
            for path in db_paths:
                if not os.path.exists(path):
                    ids_to_remove.append(path)
            
            if ids_to_remove:
                print(f"Removing {len(ids_to_remove)} dead entries from index for {directory}")
                self.collection.delete(ids=ids_to_remove)
                self.run_maintenance()
            
            # Update progress
            self.indexed_files = len(ids_to_remove)
            
            # 4. Add or update files from disk
            for filepath in disk_files:
                self.current_file = filepath
                try:
                    file_hash = compute_file_hash(filepath)
                    
                    # If already in DB with same hash, skip
                    if filepath in db_paths and db_hashes_by_path[filepath] == file_hash:
                        pass
                    else:
                        # If filepath exists in DB but hash differs, delete old entry first
                        if filepath in db_paths:
                            self.collection.delete(ids=[filepath])
                            
                        # Try to reuse existing embedding for the same content
                        existing_entries = self.collection.get(
                            where={"hash": file_hash},
                            include=["embeddings"],
                            limit=1
                        )
                        
                        if existing_entries and existing_entries.get("embeddings") is not None and len(existing_entries["embeddings"]) > 0:
                            embedding = existing_entries["embeddings"][0]
                        else:
                            # Process image
                            image = Image.open(filepath)
                            embedding = self.model_manager.get_image_embedding(image)
                        
                        self.collection.add(
                            embeddings=[embedding],
                            metadatas=[{"path": filepath, "hash": file_hash}],
                            ids=[filepath]
                        )
                except Exception as e:
                    print(f"Error re-indexing {filepath}: {e}")
                    self.error_count += 1
                    self.failed_files.append(filepath)
                
                self.indexed_files += 1
                
        finally:
            self.is_indexing = False
            self.current_file = ""
            self.last_task_id += 1

    def batch_delete_folders(self, folder_paths: list[str]):
        """Delete multiple folder indexes."""
        total_deleted = 0
        for path in folder_paths:
            total_deleted += self.delete_folder_index(path) or 0
        return total_deleted

    def run_maintenance(self):
        """Perform database maintenance: VACUUM the SQLite database and return space saved."""
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_data")
        sqlite_file = os.path.join(db_path, "chroma.sqlite3")
        
        if not os.path.exists(sqlite_file):
            return {"status": "error", "message": "Database file not found."}
            
        try:
            size_before = os.path.getsize(sqlite_file)
            
            # Connect directly to SQLite to run VACUUM
            # Note: SQLite's VACUUM requires that no other connections have an active transaction.
            # ChromaDB's PersistentClient usually keeps the connection open but idle.
            conn = sqlite3.connect(sqlite_file)
            conn.execute("VACUUM")
            conn.close()
            
            size_after = os.path.getsize(sqlite_file)
            saved = size_before - size_after
            
            return {
                "status": "success",
                "size_before": size_before,
                "size_after": size_after,
                "bytes_reclaimed": saved,
                "message": f"Maintenance complete. Reclaimed {saved / 1024:.2f} KB."
            }
        except Exception as e:
            print(f"Error during maintenance: {e}")
            return {"status": "error", "message": str(e)}

    def batch_reindex_folders(self, folder_paths: list[str]):
        """Reindex multiple folders. Should be called sequentially or in background."""
        for path in folder_paths:
            self.reindex_directory(path)

    def search(self, query: str, top_k: int = 50, min_score: float = 0.2):
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        if self.collection.count() == 0:
            return []

        query_embedding = self.model_manager.get_text_embedding(query)
        return self._do_search(query_embedding, top_k, min_score)

    def search_by_image(self, image: Image.Image, top_k: int = 50, min_score: float = 0.2):
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        if self.collection.count() == 0:
            return []

        query_embedding = self.model_manager.get_image_embedding(image)
        return self._do_search(query_embedding, top_k, min_score)

    def _do_search(self, query_embedding, top_k, min_score):
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["metadatas", "distances"]
        )
        
        if not results["metadatas"] or not results["metadatas"][0]:
            return []
            
        formatted_results = []
        for meta, dist in zip(results["metadatas"][0], results["distances"][0]):
            score = 1.0 - (dist / 2.0)
            
            if score >= min_score:
                formatted_results.append({
                    "path": meta.get("path"),
                    "hash": meta.get("hash"),
                    "score": score
                })
            
        return formatted_results
