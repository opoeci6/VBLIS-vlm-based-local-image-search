import os
import hashlib
from PIL import Image
import chromadb
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from model_manager import ModelManager
import pathlib
import paths
from media_image import IMAGE_EXTENSIONS, compute_file_hash, process_file_worker
from media_video import (
    VIDEO_EXTENSIONS, VIDEO_SAMPLING_VERSION, VIDEO_ANALYSIS_INTERVAL_SECONDS,
    VIDEO_MAX_SAMPLE_GAP_SECONDS, get_video_signature, save_video_frame_thumbnail,
    extract_video_frames_batch, iter_video_frames
)
from folder_registry import FolderRegistry
from collection_cache import CachedCollection

paths.ensure_dirs()

# How many leading search results carry their embedding for the frontend's visual-duplicate detection.
# Must match maxVisualLimit in app/src/utils/searchResults.js.
DUPLICATE_CHECK_LIMIT = 800

class _FileExistenceCache:
    """os.path.isfile answered from one directory listing per directory (one stat per file is far slower
    on Windows). Meant to live for a single search, so listings are never reused across searches."""

    def __init__(self):
        # normcased directory -> set of normcased file names; None means "listing failed, ask isfile"
        self._listings = {}

    def _list_directory(self, directory):
        try:
            with os.scandir(directory or ".") as entries:
                return {os.path.normcase(entry.name) for entry in entries if entry.is_file()}
        except (FileNotFoundError, NotADirectoryError):
            return set()
        except OSError:
            return None

    def isfile(self, path):
        directory, name = os.path.split(path)
        key = os.path.normcase(directory)
        if key not in self._listings:
            self._listings[key] = self._list_directory(directory)
        names = self._listings[key]
        if names is None:
            return os.path.isfile(path)
        return os.path.normcase(name) in names

class Indexer:
    def __init__(self, model_manager: ModelManager, db_path=None, data_dir=None, cache_dir=None):
        if db_path is None:
            db_path = paths.CHROMA_DIR
        self.db_path = str(db_path)
            
        self.model_manager = model_manager
        self.client = chromadb.PersistentClient(path=self.db_path)
        self.collection = None
        self.data_dir = pathlib.Path(data_dir if data_dir is not None else paths.DATA_DIR)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir = pathlib.Path(cache_dir if cache_dir is not None else paths.CACHE_DIR)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.video_cache_dir = self.cache_dir / "videos"
        self.folders = FolderRegistry(self.data_dir, self.cache_dir)
        
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
        self.discovered_video_count = 0
        self.indexed_video_frames = 0
        self.is_rebuilding_video_thumbnails = False
        self.rebuilt_video_frames = 0
        self.total_video_frames_to_rebuild = 0

    def cancel_indexing(self):
        self.cancel_requested = True
        print("[Notice] Indexing cancellation requested by user.")

    def _get_selected_folders(self):
        if not self.collection:
            return set()
        return self.folders.selected(self.collection.name)

    def _add_selected_folder(self, folder_path: str):
        if not self.collection:
            return
        self.folders.add(self.collection.name, folder_path)

    def is_path_in_indexed_folders(self, path: str) -> bool:
        """True when path lies in a folder indexed under any collection (used to restrict file-serving endpoints)."""
        return self.folders.is_path_allowed(path, self.collection)

    def _remove_selected_folder(self, folder_path: str):
        if not self.collection:
            return
        self.folders.remove(self.collection.name, folder_path)

    def switch_collection(self, collection_name: str):
        print(f"Switching to Chroma collection: {collection_name}")
        self.collection = CachedCollection(self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        ))
        
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
            self.folders.forget(collection_name)
            self.switch_collection(collection_name)
            self.run_maintenance()

    def delete_collection(self, collection_name: str):
        """Permanently delete a collection and its data."""
        print(f"Deleting Chroma collection: {collection_name}")
        try:
            self.client.delete_collection(name=collection_name)
            if self.collection and self.collection.name == collection_name:
                self.collection = None
            self.folders.forget(collection_name)
            self.run_maintenance()
        except Exception as e:
            print(f"Error deleting collection {collection_name}: {e}")

    def get_indexed_folders(self):
        """Get a list of unique parent directories and their subfolders currently indexed with existence status and item counts."""
        if not self._ensure_collection():
            return []
        return self.folders.build_tree(self.collection)

    def discover_media_files(self, folder_paths: list[str]):
        """Discover supported images and videos without decoding media files."""
        image_files = []
        video_files = []

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
                    file_path = os.path.join(root, file)
                    extension = os.path.splitext(file)[1].lower()
                    if extension in IMAGE_EXTENSIONS:
                        image_files.append(file_path)
                    elif extension in VIDEO_EXTENSIONS:
                        video_files.append(file_path)

        return image_files, video_files

    def get_folder_contents(self, folder_path: str, limit: int = 50000):
        """List supported media in a folder with indexing status and ghost record detection."""
        collection = self.collection if self._ensure_collection() else None
        return self.folders.folder_contents(collection, folder_path, limit)

    def _get_existing_video_entries(self, collection_results=None):
        """Group indexed video-frame records by their source video path."""
        if collection_results is None:
            collection_results = self.collection.get(include=["metadatas"])

        grouped = {}
        ids = collection_results.get("ids", []) if collection_results else []
        metadatas = collection_results.get("metadatas", []) if collection_results else []
        for record_id, metadata in zip(ids, metadatas):
            if not metadata or metadata.get("media_type") != "video":
                continue
            source_path = os.path.normpath(metadata.get("path", ""))
            if source_path:
                ts = metadata.get("timestamp_seconds")
                if ts is None:
                    try:
                        ts = float(record_id.split(":")[-1]) / 1000.0
                    except Exception:
                        ts = 0.0
                grouped.setdefault(source_path, []).append({
                    "id": record_id,
                    "timestamp_seconds": float(ts),
                    "source_signature": metadata.get("source_signature")
                })
        return grouped

    def _add_video_frame_batch(self, images, metadatas, record_ids, task_context=None):
        """Embed and store one video-frame batch, falling back per frame on failure."""
        stored_count = 0
        try:
            embeddings = self.model_manager.get_image_embeddings_batch(images, task_context=task_context)
            if embeddings:
                self.collection.add(
                    embeddings=embeddings,
                    metadatas=metadatas,
                    ids=record_ids
                )
                stored_count = len(record_ids)
        except Exception as e:
            print(f"Video frame batch embedding failed, falling back frame-by-frame: {e}")
            for image, metadata, record_id in zip(images, metadatas, record_ids):
                if task_context and not task_context.check_paused_or_cancelled():
                    break
                try:
                    embedding = self.model_manager.get_image_embedding(image, task_context=task_context)
                    if embedding:
                        self.collection.add(
                            embeddings=[embedding],
                            metadatas=[metadata],
                            ids=[record_id]
                        )
                        stored_count += 1
                except Exception as frame_error:
                    print(f"Error indexing video frame {record_id}: {frame_error}")
                    self.error_count += 1
                    self.failed_files.append(
                        f"{metadata['path']} @ {metadata['timestamp_seconds']:.2f}s"
                    )
        finally:
            for image in images:
                try:
                    image.close()
                except Exception:
                    pass
        return stored_count

    def _index_video_file(self, filepath, source_signature, batch_size, task_context=None):
        """Extract and index adaptive scene-aware frames from one video."""
        normalized_path = os.path.abspath(os.path.normpath(filepath))
        source_key = hashlib.sha256(normalized_path.lower().encode("utf-8")).hexdigest()
        stat = os.stat(normalized_path)
        pending_images = []
        pending_metadatas = []
        pending_ids = []
        attempted_ids = []
        stored_count = 0

        def should_cancel_fn():
            if self.cancel_requested:
                return True
            if task_context and not task_context.check_paused_or_cancelled():
                return True
            return False

        try:
            for timestamp, image, sampling_metadata in iter_video_frames(
                normalized_path,
                should_cancel=should_cancel_fn
            ):
                if should_cancel_fn():
                    image.close()
                    break

                # Save 480x480 thumbnail at indexing time for instant 0ms search lookup
                save_video_frame_thumbnail(normalized_path, timestamp, image, self.video_cache_dir, stat)

                timestamp_ms = int(round(timestamp * 1000))
                record_id = f"video:{source_key}:{timestamp_ms}"
                frame_hash = hashlib.sha256(
                    f"{source_key}:{source_signature}:{timestamp_ms}".encode("utf-8")
                ).hexdigest()
                pending_images.append(image)
                pending_metadatas.append({
                    "path": normalized_path,
                    "hash": frame_hash,
                    "media_type": "video",
                    "timestamp_seconds": float(timestamp),
                    "sampling_strategy": VIDEO_SAMPLING_VERSION,
                    "analysis_interval_seconds": VIDEO_ANALYSIS_INTERVAL_SECONDS,
                    "max_sample_gap_seconds": VIDEO_MAX_SAMPLE_GAP_SECONDS,
                    "scene_id": sampling_metadata["scene_id"],
                    "sampling_reason": sampling_metadata["sampling_reason"],
                    "scene_change_score": sampling_metadata["scene_change_score"],
                    "source_signature": source_signature
                })
                pending_ids.append(record_id)
                attempted_ids.append(record_id)

                if len(pending_images) >= batch_size:
                    stored_count += self._add_video_frame_batch(
                        pending_images, pending_metadatas, pending_ids, task_context=task_context
                    )
                    pending_images, pending_metadatas, pending_ids = [], [], []

            if self.cancel_requested or (task_context and task_context.cancel_requested):
                for image in pending_images:
                    image.close()
                if attempted_ids:
                    self.collection.delete(ids=attempted_ids)
                return 0

            if pending_images:
                stored_count += self._add_video_frame_batch(
                    pending_images, pending_metadatas, pending_ids, task_context=task_context
                )

            if stored_count == 0:
                raise ValueError("No decodable frames were found in the video.")
            return stored_count
        except Exception:
            for image in pending_images:
                try:
                    image.close()
                except Exception:
                    pass
            if attempted_ids:
                try:
                    self.collection.delete(ids=attempted_ids)
                except Exception:
                    pass
            raise

    def _index_video_files(self, video_files, existing_video_entries=None, task_context=None):
        """Index new or changed videos while preserving unchanged frame records."""
        existing_video_entries = existing_video_entries or {}
        batch_size = self.model_manager.get_effective_batch_size()

        for filepath in video_files:
            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                break

            normalized_path = os.path.abspath(os.path.normpath(filepath))
            self.current_file = normalized_path
            if task_context:
                task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(normalized_path))
            try:
                source_signature = get_video_signature(normalized_path)
                previous_entries = existing_video_entries.get(normalized_path, [])
                if previous_entries and all(
                    entry.get("source_signature") == source_signature
                    for entry in previous_entries
                ):
                    self.indexed_video_frames += len(previous_entries)
                    continue

                old_ids = [entry["id"] for entry in previous_entries]
                if old_ids:
                    self.collection.delete(ids=old_ids)

                frame_count = self._index_video_file(
                    normalized_path, source_signature, batch_size, task_context=task_context
                )
                self.indexed_video_frames += frame_count
            except Exception as e:
                print(f"Error indexing video {normalized_path}: {e}")
                self.error_count += 1
                self.failed_files.append(normalized_path)
                if task_context:
                    task_context.add_error(f"{os.path.basename(normalized_path)}: {e}")
            finally:
                self.indexed_files += 1
                if task_context:
                    task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(normalized_path))

    def delete_folder_index(self, folder_path: str):
        """Delete all index entries belonging to a specific folder."""
        if not self._ensure_collection():
            return 0
            
        try:
            norm_folder = os.path.abspath(os.path.normpath(folder_path))
            norm_folder_lower = norm_folder.lower()
            self._remove_selected_folder(folder_path)
            
            results = self.collection.get(include=["metadatas"])
            ids_to_delete = []
            
            for i, meta in enumerate(results["metadatas"]):
                if meta and "path" in meta:
                    file_path = os.path.abspath(os.path.normpath(meta["path"]))
                    file_path_lower = file_path.lower()
                    if file_path_lower == norm_folder_lower or file_path_lower.startswith(norm_folder_lower + os.sep):
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
            "total_files": self.total_files,
            "indexed_files": self.indexed_files,
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
            "cancel_requested": self.cancel_requested,
            "discovered_video_count": self.discovered_video_count,
            "indexed_video_frames": self.indexed_video_frames,
            "is_rebuilding_video_thumbnails": self.is_rebuilding_video_thumbnails,
            "rebuilt_video_frames": self.rebuilt_video_frames,
            "total_video_frames_to_rebuild": self.total_video_frames_to_rebuild
        }

    def regenerate_video_thumbnails(self, task_context=None):
        """Regenerate all video frame thumbnails for all indexed videos in the active collection."""
        if (self.is_indexing or self.is_rebuilding_video_thumbnails) and task_context is None:
            return {"status": "error", "message": "Another indexing or rebuild task is already running."}

        if not self._ensure_collection():
            if task_context:
                task_context.add_error("No active collection.")
            return {"status": "error", "message": "No active collection."}

        self.is_rebuilding_video_thumbnails = True
        self.rebuilt_video_frames = 0
        self.total_video_frames_to_rebuild = 0

        try:
            entries_by_path = self._get_existing_video_entries()
            if not entries_by_path:
                if task_context:
                    task_context.update_progress(0, 0, "No indexed video records found.")
                return {"status": "success", "message": "No indexed video records found.", "rebuilt": 0}

            total_frames = 0
            for filepath, entries in entries_by_path.items():
                if os.path.isfile(filepath):
                    total_frames += len(entries)
            self.total_video_frames_to_rebuild = total_frames
            if task_context:
                task_context.update_progress(0, total_frames, "Starting video thumbnail rebuild...")

            for filepath, entries in entries_by_path.items():
                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                    break
                if not os.path.isfile(filepath):
                    continue
                timestamps = [float(e["timestamp_seconds"]) for e in entries if "timestamp_seconds" in e]
                if timestamps:
                    def on_frame_done(_ts):
                        self.rebuilt_video_frames += 1
                        if task_context:
                            task_context.update_progress(
                                self.rebuilt_video_frames,
                                self.total_video_frames_to_rebuild,
                                os.path.basename(filepath)
                            )

                    extract_video_frames_batch(filepath, timestamps, self.video_cache_dir, on_frame_saved=on_frame_done)

            return {
                "status": "success",
                "message": f"Successfully regenerated {self.rebuilt_video_frames} video thumbnails.",
                "rebuilt": self.rebuilt_video_frames
            }
        except Exception as e:
            print(f"Error rebuilding video thumbnails: {e}")
            if task_context:
                task_context.add_error(str(e))
            return {"status": "error", "message": str(e)}
        finally:
            self.is_rebuilding_video_thumbnails = False

    def _index_image_files(self, files, task_context=None, known=None, label="Indexing"):
        """Embed and store image files in batched chunks (shared by index and reindex).
        known=None (index): files are the pending ones and are all added.
        known={normalized path: (stored record id, stored hash)} (reindex): a file whose hash is unchanged
        is skipped, a changed one has its stored record deleted before it is added again.
        """
        batch_size = self.model_manager.get_effective_batch_size()
        max_workers = min(16, max(2, (os.cpu_count() or 4)))

        for i in range(0, len(files), batch_size):
            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                print(f"[Notice] {label} cancelled by user.")
                break

            chunk_files = files[i:i + batch_size]
            if not chunk_files:
                continue
            self.current_file = chunk_files[0]
            if task_context:
                task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(self.current_file))

            # 1. Parallel CPU preprocessing (file hashing & PIL image opening)
            worker_results = []
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_file = {executor.submit(process_file_worker, f): f for f in chunk_files}
                for future in as_completed(future_to_file):
                    if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                        break
                    res = future.result()
                    worker_results.append(res)

            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                # Clean up opened images if cancelled mid-batch
                for _, _, img, _ in worker_results:
                    if img:
                        try:
                            img.close()
                        except Exception:
                            pass
                print(f"[Notice] {label} cancelled by user.")
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
                    if task_context:
                        task_context.add_error(f"{os.path.basename(filepath)}: {err}")
                        task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
                    continue

                if known is not None and filepath in known:
                    stored_id, stored_hash = known[filepath]
                    # If already in DB with same hash, skip
                    if stored_hash == file_hash:
                        try:
                            image.close()
                        except Exception:
                            pass
                        self.indexed_files += 1
                        if task_context:
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
                        continue
                    # If filepath exists in DB but hash differs, delete the stored entry first
                    try:
                        self.collection.delete(ids=[stored_id])
                    except Exception:
                        pass
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

            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                break

            for filepath, file_hash, image in valid_worker_items:
                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                    break

                if file_hash in existing_hash_map:
                    try:
                        embedding = existing_hash_map[file_hash]
                        self.collection.add(
                            embeddings=[embedding],
                            metadatas=[{"path": filepath, "hash": file_hash, "media_type": "image"}],
                            ids=[filepath]
                        )
                    except Exception as e:
                        print(f"Error adding reused embedding for {filepath}: {e}")
                        if task_context:
                            task_context.add_error(f"{os.path.basename(filepath)}: {e}")
                    finally:
                        try:
                            image.close()
                        except Exception:
                            pass
                        self.indexed_files += 1
                        if task_context:
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
                else:
                    valid_images.append(image)
                    valid_metas.append({"path": filepath, "hash": file_hash, "media_type": "image"})
                    valid_ids.append(filepath)

            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                break

            # 5. Batched GPU inference for new images
            if valid_images:
                try:
                    embeddings = self.model_manager.get_image_embeddings_batch(valid_images, task_context=task_context)
                    if embeddings:
                        self.collection.add(
                            embeddings=embeddings,
                            metadatas=valid_metas,
                            ids=valid_ids
                        )
                        self.indexed_files += len(valid_ids)
                        if task_context:
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(valid_ids[-1]))
                except Exception as e:
                    print(f"Batch embedding failed during {label.lower()}, falling back to item-by-item: {e}")
                    for img, meta, fid in zip(valid_images, valid_metas, valid_ids):
                        if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                            break
                        try:
                            emb = self.model_manager.get_image_embedding(img, task_context=task_context)
                            if emb:
                                self.collection.add(
                                    embeddings=[emb],
                                    metadatas=[meta],
                                    ids=[fid]
                                )
                        except Exception as ex:
                            print(f"Error in {label.lower()} item fallback {fid}: {ex}")
                            self.error_count += 1
                            self.failed_files.append(fid)
                            if task_context:
                                task_context.add_error(f"{os.path.basename(fid)}: {ex}")
                        finally:
                            self.indexed_files += 1
                            if task_context:
                                task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(fid))
                finally:
                    for img in valid_images:
                        try:
                            img.close()
                        except Exception:
                            pass

    def batch_index_folders(self, folder_paths: list[str], task_context=None):
        if self.is_indexing and task_context is None:
            return  # Prevent concurrent indexing
            
        self.is_indexing = True
        self.cancel_requested = False
        self.error_count = 0
        self.indexed_files = 0
        self.discovered_video_count = 0
        self.indexed_video_frames = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        # Ensure collection is set
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())

        for folder_path in folder_paths:
            if os.path.isdir(folder_path):
                self._add_selected_folder(folder_path)
            
        self.failed_files = []
        
        try:
            if task_context:
                task_context.update_progress(0, 0, "Discovering media files...")
            files_to_index, discovered_videos = self.discover_media_files(folder_paths)
            self.discovered_video_count = len(discovered_videos)
            self.total_files = len(files_to_index) + len(discovered_videos)
            if task_context:
                task_context.update_progress(0, self.total_files, "Comparing index cache...")
            
            # Get existing IDs (paths) to avoid redundant work
            existing_results = self.collection.get(include=["metadatas"])
            # Compared by normalized path so the same file reached through a differently written folder
            # path (slashes, "." segments, drive-letter case) is not indexed twice
            existing_paths = set()
            if existing_results:
                for meta in existing_results.get("metadatas") or []:
                    if meta and meta.get("path") and meta.get("media_type", "image") != "video":
                        existing_paths.add(os.path.normcase(os.path.normpath(meta["path"])))
            existing_video_entries = self._get_existing_video_entries(existing_results)
            
            # Filter out already indexed files
            pending_files = [f for f in files_to_index if os.path.normcase(os.path.normpath(f)) not in existing_paths]
            self.indexed_files = len(files_to_index) - len(pending_files)
            if task_context:
                task_context.update_progress(self.indexed_files, self.total_files, "Indexing items...")

            self._index_image_files(pending_files, task_context=task_context, label="Indexing")

            if not self.cancel_requested and not (task_context and task_context.cancel_requested):
                self._index_video_files(discovered_videos, existing_video_entries, task_context=task_context)
        finally:
            self.is_indexing = False
            self.current_file = ""
            self.last_task_id += 1

    def reindex_directory(self, directory: str, task_context=None):
        """Synchronize the index with the current state of a directory.
        Adds new/changed files, removes files no longer on disk.
        """
        if self.is_indexing and task_context is None:
            return
            
        if not os.path.isdir(directory):
            print(f"[Error] Cannot reindex: Directory '{directory}' not found.")
            if task_context:
                task_context.add_error(f"Directory '{directory}' not found.")
            return

        self.is_indexing = True
        self.cancel_requested = False
        self.error_count = 0
        self.indexed_files = 0
        self.discovered_video_count = 0
        self.indexed_video_frames = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())

        self._add_selected_folder(directory)
            
        self.failed_files = []
        
        try:
            norm_target = os.path.normpath(directory)
            if task_context:
                task_context.update_progress(0, 0, f"Scanning {os.path.basename(norm_target)}...")

            # 1. Get current files on disk
            discovered_images, discovered_videos = self.discover_media_files([directory])
            disk_files = [os.path.normpath(path) for path in discovered_images]
            disk_video_files = [os.path.normpath(path) for path in discovered_videos]
            self.discovered_video_count = len(discovered_videos)
            
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
                                "hash": meta.get("hash"),
                                "media_type": meta.get("media_type", "image")
                            })

            db_image_entries = [e for e in db_entries if e["media_type"] != "video"]
            known = {e["path"]: (e["id"], e["hash"]) for e in db_image_entries}
            stale_entries = [e for e in db_entries if not os.path.exists(e["path"])]
            stale_source_paths = {e["path"] for e in stale_entries}
            existing_video_entries = self._get_existing_video_entries(results)

            self.total_files = len(disk_files) + len(disk_video_files) + len(stale_source_paths)
            if task_context:
                task_context.update_progress(0, self.total_files, "Cleaning stale entries...")
            
            # 3. Remove entries from DB that are no longer on disk
            ids_to_remove = [entry["id"] for entry in stale_entries]
            
            if ids_to_remove:
                print(f"Removing {len(ids_to_remove)} dead entries from index for {directory}")
                self.collection.delete(ids=ids_to_remove)
                self.run_maintenance()
            
            # Update progress
            self.indexed_files = len(stale_source_paths)
            if task_context:
                task_context.update_progress(self.indexed_files, self.total_files, "Processing updated files...")
            
            # 4. Add or update files from disk in batched chunks
            self._index_image_files(disk_files, task_context=task_context, known=known, label="Re-indexing")

            if not self.cancel_requested and not (task_context and task_context.cancel_requested):
                self._index_video_files(disk_video_files, existing_video_entries, task_context=task_context)
                
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
        if self.is_indexing or self.is_rebuilding_video_thumbnails:
            # A second sqlite connection could race the writer Chroma uses while indexing
            return {"status": "skipped", "message": "Maintenance skipped while indexing is in progress."}

        sqlite_file = os.path.join(self.db_path, "chroma.sqlite3")
        
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

    def batch_reindex_folders(self, folder_paths: list[str], task_context=None):
        """Reindex multiple folders. Should be called sequentially or in background."""
        for path in folder_paths:
            if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                break
            self.reindex_directory(path, task_context=task_context)

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
        if top_k < 1:
            return []
        total = self.collection.count()
        if total == 0:
            return []

        # Query without embeddings and walk the ranking: records whose file is gone are skipped so they
        # cannot crowd out existing results, and the walk stops at the first score under min_score
        # (scores are sorted descending). If missing files left fewer than top_k results from a full
        # batch, query again with a larger n (the HNSW order can shift slightly, so start from scratch).
        n = min(top_k, total)
        file_exists = _FileExistenceCache()  # shared by the re-query passes
        while True:
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=n,
                include=["metadatas", "distances"]
            )
            raw_ids = results["ids"][0] if results.get("ids") else []
            raw_metas = results["metadatas"][0] if results.get("metadatas") else []
            raw_dists = results["distances"][0] if results.get("distances") else []

            found = []
            cut_off = False
            for record_id, meta, dist in zip(raw_ids, raw_metas, raw_dists):
                score = 1.0 - (dist / 2.0)
                if score < min_score:
                    cut_off = True
                    break
                filepath = meta.get("path") if meta else None
                if not filepath or not file_exists.isfile(filepath):
                    continue
                found.append((record_id, meta, score))
                if len(found) >= top_k:
                    break

            if len(found) >= top_k or cut_off or len(raw_ids) < n or n >= total:
                break
            n = min(n * 2, total)

        # Embeddings are only needed for the results the frontend runs duplicate detection on
        embeddings_by_id = {}
        head_ids = [record_id for record_id, _, _ in found[:DUPLICATE_CHECK_LIMIT]]
        if head_ids:
            fetched = self.collection.get(ids=head_ids, include=["embeddings"])
            fetched_embeddings = fetched.get("embeddings")
            if fetched_embeddings is not None:
                for record_id, emb in zip(fetched["ids"], fetched_embeddings):
                    embeddings_by_id[record_id] = emb

        formatted_results = []
        for record_id, meta, score in found:
            filepath = meta.get("path")
            file_hash = meta.get("hash")

            # If hash is missing from metadata, compute on the fly so frontend duplicate detection always works
            if not file_hash:
                try:
                    file_hash = compute_file_hash(filepath)
                except Exception:
                    pass

            emb = embeddings_by_id.get(record_id)
            if hasattr(emb, "tolist"):
                emb = emb.tolist()
            elif isinstance(emb, (list, tuple)):
                emb = [float(x) for x in emb]

            formatted_results.append({
                "id": record_id,
                "path": filepath,
                "hash": file_hash,
                "media_type": meta.get("media_type", "image"),
                "timestamp_seconds": meta.get("timestamp_seconds"),
                "scene_id": meta.get("scene_id"),
                "sampling_reason": meta.get("sampling_reason"),
                "score": float(score),
                "embedding": emb
            })

        return formatted_results
