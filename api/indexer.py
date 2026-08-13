import os
import hashlib
from PIL import Image
import pillow_heif
import chromadb
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from model_manager import ModelManager

pillow_heif.register_heif_opener()

def compute_file_hash(filepath, chunk_size=8192):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()

def process_file_worker(filepath):
    """Worker function for multithreaded CPU preprocessing pool.
    Calculates SHA-256 hash and pre-loads PIL image in parallel.
    """
    try:
        file_hash = compute_file_hash(filepath)
        img = Image.open(filepath)
        img.load()  # Force image decode into CPU memory in thread pool
        return (filepath, file_hash, img, None)
    except Exception as e:
        return (filepath, None, None, str(e))

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
        self.cancel_requested = False
        self.total_files = 0
        self.indexed_files = 0
        self.current_file = ""
        self.error_count = 0
        self.failed_files = []
        self.last_task_id = 0

    def cancel_indexing(self):
        self.cancel_requested = True
        print("[Notice] Indexing cancellation requested by user.")

        
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
            "is_loading_model": self.model_manager.is_loading_model,
            "oom_triggered": getattr(self.model_manager, "oom_triggered", False),
            "cancel_requested": self.cancel_requested
        }



    def index_directory(self, directory: str):
        self.batch_index_folders([directory])

    def batch_index_folders(self, folder_paths: list[str]):
        if self.is_indexing:
            return  # Prevent concurrent indexing
            
        self.is_indexing = True
        self.cancel_requested = False
        self.error_count = 0
        self.indexed_files = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        # Ensure collection is set
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        self.failed_files = []
        
        try:
            valid_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic"}
            files_to_index = []
            
            for directory in folder_paths:
                if self.cancel_requested:
                    break
                if not os.path.isdir(directory):
                    print(f"[Warning] Indexer: Skipping invalid directory {directory}")
                    continue
                for root, _, files in os.walk(directory):
                    if self.cancel_requested:
                        break
                    for file in files:
                        if os.path.splitext(file)[1].lower() in valid_extensions:
                            files_to_index.append(os.path.join(root, file))
            
            self.total_files = len(files_to_index)
            
            # Get existing IDs (paths) to avoid redundant work
            existing_results = self.collection.get(include=[])
            existing_ids = set(existing_results["ids"]) if existing_results and "ids" in existing_results else set()
            
            # Filter out already indexed files
            pending_files = [f for f in files_to_index if f not in existing_ids]
            self.indexed_files = self.total_files - len(pending_files)

            batch_size = self.model_manager.get_effective_batch_size()
            max_workers = min(16, max(2, (os.cpu_count() or 4)))

            for i in range(0, len(pending_files), batch_size):
                if self.cancel_requested:
                    print("[Notice] Indexing cancelled by user.")
                    break

                chunk_files = pending_files[i:i + batch_size]
                if not chunk_files:
                    continue
                self.current_file = chunk_files[0]

                # 1. Parallel CPU preprocessing (file hashing & PIL image opening)
                worker_results = []
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_file = {executor.submit(process_file_worker, f): f for f in chunk_files}
                    for future in as_completed(future_to_file):
                        if self.cancel_requested:
                            break
                        res = future.result()
                        worker_results.append(res)

                if self.cancel_requested:
                    # Clean up opened images if cancelled mid-batch
                    for _, _, img, _ in worker_results:
                        if img:
                            try:
                                img.close()
                            except Exception:
                                pass
                    print("[Notice] Indexing cancelled by user.")
                    break

                # 2. Collect valid items & gather hashes for batched ChromaDB check
                valid_worker_items = []
                chunk_hashes = []
                for filepath, file_hash, image, err in worker_results:
                    if err or not file_hash or not image:
                        print(f"Error preparing {filepath}: {err}")
                        self.error_count += 1
                        self.failed_files.append(filepath)
                        self.indexed_files += 1
                    else:
                        valid_worker_items.append((filepath, file_hash, image))
                        chunk_hashes.append(file_hash)

                if not valid_worker_items:
                    continue

                # 3. Perform a single bulk ChromaDB query for all hashes in this batch
                existing_hash_map = {}
                if chunk_hashes:
                    try:
                        unique_hashes = list(set(chunk_hashes))
                        db_hits = self.collection.get(
                            where={"hash": {"$in": unique_hashes}},
                            include=["embeddings", "metadatas"]
                        )
                        if db_hits and db_hits.get("metadatas"):
                            for meta, emb in zip(db_hits["metadatas"], db_hits["embeddings"]):
                                if meta and "hash" in meta and emb is not None and len(emb) > 0:
                                    existing_hash_map[meta["hash"]] = emb
                    except Exception:
                        pass

                # 4. Separate reused content from new images needing GPU inference
                valid_images = []
                valid_metas = []
                valid_ids = []

                for filepath, file_hash, image in valid_worker_items:
                    if file_hash in existing_hash_map:
                        try:
                            embedding = existing_hash_map[file_hash]
                            self.collection.add(
                                embeddings=[embedding],
                                metadatas=[{"path": filepath, "hash": file_hash}],
                                ids=[filepath]
                            )
                            existing_ids.add(filepath)
                        except Exception as e:
                            print(f"Error adding reused embedding for {filepath}: {e}")
                        finally:
                            try:
                                image.close()
                            except Exception:
                                pass
                            self.indexed_files += 1
                    else:
                        valid_images.append(image)
                        valid_metas.append({"path": filepath, "hash": file_hash})
                        valid_ids.append(filepath)

                # 5. Batched GPU inference for new images
                if valid_images:
                    try:
                        embeddings = self.model_manager.get_image_embeddings_batch(valid_images)
                        self.collection.add(
                            embeddings=embeddings,
                            metadatas=valid_metas,
                            ids=valid_ids
                        )
                        for fid in valid_ids:
                            existing_ids.add(fid)
                        self.indexed_files += len(valid_ids)
                    except Exception as e:
                        print(f"Batch embedding failed, falling back to item-by-item: {e}")
                        for img, meta, fid in zip(valid_images, valid_metas, valid_ids):
                            try:
                                emb = self.model_manager.get_image_embedding(img)
                                self.collection.add(
                                    embeddings=[emb],
                                    metadatas=[meta],
                                    ids=[fid]
                                )
                                existing_ids.add(fid)
                            except Exception as ex:
                                print(f"Error indexing item fallback {fid}: {ex}")
                                self.error_count += 1
                                self.failed_files.append(fid)
                            finally:
                                self.indexed_files += 1
                    finally:
                        for img in valid_images:
                            try:
                                img.close()
                            except Exception:
                                pass
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
        self.cancel_requested = False
        self.error_count = 0
        self.indexed_files = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())
            
        self.failed_files = []
        
        try:
            valid_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic"}
            norm_target = os.path.normpath(directory)
            
            # 1. Get current files on disk
            disk_files = []
            for root, _, files in os.walk(directory):
                if self.cancel_requested:
                    break
                for file in files:
                    if os.path.splitext(file)[1].lower() in valid_extensions:
                        disk_files.append(os.path.normpath(os.path.join(root, file)))
            
            # 2. Get current files in index for this directory
            results = self.collection.get(include=["metadatas"])
            db_entries = [] # List of (id, path, hash)
            if results and results.get("metadatas"):
                for i, meta in enumerate(results["metadatas"]):
                    if meta and "path" in meta:
                        db_path = os.path.normpath(meta["path"])
                        if db_path == norm_target or db_path.startswith(norm_target + os.sep):
                            db_entries.append({
                                "id": results["ids"][i],
                                "path": db_path,
                                "hash": meta.get("hash")
                            })
            
            db_paths = {e["path"] for e in db_entries}
            db_hashes_by_path = {e["path"]: e["hash"] for e in db_entries}
            
            self.total_files = len(disk_files) + len(db_paths)
            
            # 3. Remove entries from DB that are no longer on disk
            ids_to_remove = [path for path in db_paths if not os.path.exists(path)]
            
            if ids_to_remove:
                print(f"Removing {len(ids_to_remove)} dead entries from index for {directory}")
                self.collection.delete(ids=ids_to_remove)
                self.run_maintenance()
            
            # Update progress
            self.indexed_files = len(ids_to_remove)
            
            # 4. Add or update files from disk in batched chunks
            batch_size = self.model_manager.get_effective_batch_size()
            max_workers = min(16, max(2, (os.cpu_count() or 4)))

            for i in range(0, len(disk_files), batch_size):
                if self.cancel_requested:
                    print("[Notice] Re-indexing cancelled by user.")
                    break

                chunk_files = disk_files[i:i + batch_size]
                if not chunk_files:
                    continue
                self.current_file = chunk_files[0]

                # Parallel CPU preprocessing
                worker_results = []
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_file = {executor.submit(process_file_worker, f): f for f in chunk_files}
                    for future in as_completed(future_to_file):
                        if self.cancel_requested:
                            break
                        worker_results.append(future.result())

                if self.cancel_requested:
                    for _, _, img, _ in worker_results:
                        if img:
                            try:
                                img.close()
                            except Exception:
                                pass
                    print("[Notice] Re-indexing cancelled by user.")
                    break

                # Filter out files that already exist in DB with unchanged hash
                items_needing_indexing = []
                chunk_hashes = []
                for filepath, file_hash, image, err in worker_results:
                    if err or not file_hash or not image:
                        print(f"Error preparing {filepath}: {err}")
                        self.error_count += 1
                        self.failed_files.append(filepath)
                        self.indexed_files += 1
                        continue

                    # If already in DB with same hash, skip
                    if filepath in db_paths and db_hashes_by_path.get(filepath) == file_hash:
                        try:
                            image.close()
                        except Exception:
                            pass
                        self.indexed_files += 1
                    else:
                        # If filepath exists in DB but hash differs, delete old entry first
                        if filepath in db_paths:
                            try:
                                self.collection.delete(ids=[filepath])
                            except Exception:
                                pass
                        items_needing_indexing.append((filepath, file_hash, image))
                        chunk_hashes.append(file_hash)

                if not items_needing_indexing:
                    continue

                # Bulk query ChromaDB for existing hashes to reuse embeddings
                existing_hash_map = {}
                if chunk_hashes:
                    try:
                        unique_hashes = list(set(chunk_hashes))
                        db_hits = self.collection.get(
                            where={"hash": {"$in": unique_hashes}},
                            include=["embeddings", "metadatas"]
                        )
                        if db_hits and db_hits.get("metadatas"):
                            for meta, emb in zip(db_hits["metadatas"], db_hits["embeddings"]):
                                if meta and "hash" in meta and emb is not None and len(emb) > 0:
                                    existing_hash_map[meta["hash"]] = emb
                    except Exception:
                        pass

                valid_images = []
                valid_metas = []
                valid_ids = []

                for filepath, file_hash, image in items_needing_indexing:
                    if file_hash in existing_hash_map:
                        try:
                            embedding = existing_hash_map[file_hash]
                            self.collection.add(
                                embeddings=[embedding],
                                metadatas=[{"path": filepath, "hash": file_hash}],
                                ids=[filepath]
                            )
                        except Exception as e:
                            print(f"Error adding reused embedding for {filepath}: {e}")
                        finally:
                            try:
                                image.close()
                            except Exception:
                                pass
                            self.indexed_files += 1
                    else:
                        valid_images.append(image)
                        valid_metas.append({"path": filepath, "hash": file_hash})
                        valid_ids.append(filepath)

                if valid_images:
                    try:
                        embeddings = self.model_manager.get_image_embeddings_batch(valid_images)
                        self.collection.add(
                            embeddings=embeddings,
                            metadatas=valid_metas,
                            ids=valid_ids
                        )
                        self.indexed_files += len(valid_ids)
                    except Exception as e:
                        print(f"Batch embedding failed during reindex fallback: {e}")
                        for img, meta, fid in zip(valid_images, valid_metas, valid_ids):
                            try:
                                emb = self.model_manager.get_image_embedding(img)
                                self.collection.add(
                                    embeddings=[emb],
                                    metadatas=[meta],
                                    ids=[fid]
                                )
                            except Exception as ex:
                                print(f"Error re-indexing item fallback {fid}: {ex}")
                                self.error_count += 1
                                self.failed_files.append(fid)
                            finally:
                                self.indexed_files += 1
                    finally:
                        for img in valid_images:
                            try:
                                img.close()
                            except Exception:
                                pass
                
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
            include=["metadatas", "distances", "embeddings"]
        )
        
        if not results["metadatas"] or not results["metadatas"][0]:
            return []
            
        embeddings_list = results["embeddings"][0] if results.get("embeddings") and len(results["embeddings"]) > 0 else []

        formatted_results = []
        for i, (meta, dist) in enumerate(zip(results["metadatas"][0], results["distances"][0])):
            score = 1.0 - (dist / 2.0)
            
            if score >= min_score:
                filepath = meta.get("path") if meta else None
                file_hash = meta.get("hash") if meta else None
                
                # If hash is missing from metadata, compute on the fly so frontend duplicate detection always works
                if not file_hash and filepath and os.path.isfile(filepath):
                    try:
                        file_hash = compute_file_hash(filepath)
                    except Exception:
                        pass

                emb = embeddings_list[i] if i < len(embeddings_list) else None
                if hasattr(emb, "tolist"):
                    emb = emb.tolist()
                elif isinstance(emb, (list, tuple)):
                    emb = [float(x) for x in emb]

                formatted_results.append({
                    "path": filepath,
                    "hash": file_hash,
                    "score": float(score),
                    "embedding": emb
                })
            
        return formatted_results
