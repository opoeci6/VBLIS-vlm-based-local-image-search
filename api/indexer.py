import os
import hashlib
from PIL import Image
import chromadb
import sqlite3
import collections
import itertools
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from model_manager import ModelManager
import pathlib
import paths
from media_image import (
    IMAGE_EXTENSIONS, IMAGE_EMBED_VERSION, compute_file_hash, inspect_file, open_image_upright,
    read_rotated
)
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

def _walk_file_entries(top):
    """os.walk(top) order (top-down, a directory's files before its subdirectories, symlinked directories not
    followed, unreadable directories skipped), yielding (directory, [os.DirEntry of its files]).
    The entries carry the stat that the directory listing already holds (free on Windows)."""
    try:
        with os.scandir(top) as scan:
            entries = list(scan)
    except OSError:
        return
    file_entries = []
    subdirectories = []
    for entry in entries:
        try:
            is_dir = entry.is_dir()
        except OSError:
            is_dir = False
        (subdirectories if is_dir else file_entries).append(entry)
    yield top, file_entries
    for entry in subdirectories:
        if not entry.is_symlink():
            yield from _walk_file_entries(os.path.join(top, entry.name))

class _ChunkPlan:
    """What one chunk of image files needs, as sorted out by Indexer._classify_chunk."""

    def __init__(self):
        # (path, hash, rotated or None when not read, id of the stored record it replaces or None) of the files
        # that need an embedding (reused or computed)
        self.candidates = []
        self.update_ids = []     # stored records whose metadata is rewritten
        self.update_metas = []
        self.upgrades = 0        # how many of those updates are version upgrades
        self.reembedded = 0      # outdated records of rotated files, embedded again

# Decoding runs on fewer threads than hashing: a 48 MP photo takes a few hundred MB while it is decoded and
# preprocessed (the chunked indexing before kept a whole GPU batch of decoded images in memory)
_DECODE_WORKERS = 8

class _EmbedJob:
    """A file on its way to the GPU: decoded and preprocessed in the pool, embedded in file order.
    stored_id is the record it replaces once stored (a changed file on reindex), or None.
    Followers are (path, stored_id) of same-hash files of the same run that copy its embedding instead of
    being decoded."""
    __slots__ = ("filepath", "file_hash", "stored_id", "future", "followers")

    def __init__(self, filepath, file_hash, stored_id, future, followers=()):
        self.filepath = filepath
        self.file_hash = file_hash
        self.stored_id = stored_id
        self.future = future
        self.followers = list(followers)

def _prepare_file(model_manager, filepath):
    """Pool worker: decodes the file upright and preprocesses it for the model, closing the full-size image
    right away. Returns (PreparedImage, None), or (None, error text) when either step fails."""
    try:
        image = open_image_upright(filepath)[0]
    except Exception as e:
        return None, str(e)
    try:
        return model_manager.prepare_image(image), None
    except Exception as e:
        return None, str(e)
    finally:
        image.close()

def _ordered_results(pool, fn, items, window):
    """Yields (item, fn(item)) in item order while up to `window` calls run ahead in the pool.
    Closing the generator cancels the calls that have not started yet."""
    pending = collections.deque()
    items = iter(items)
    try:
        for item in itertools.islice(items, window):
            pending.append((item, pool.submit(fn, item)))
        while pending:
            item, future = pending.popleft()
            for following in itertools.islice(items, 1):
                pending.append((following, pool.submit(fn, following)))
            yield item, future.result()
    finally:
        for _, future in pending:
            future.cancel()

def _chunked(iterable, size):
    chunk = []
    for item in iterable:
        chunk.append(item)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk

class _EmbedQueue:
    """Files waiting for the GPU, in file order. Each one is decoded and preprocessed in the pool as soon as it
    is queued; a file whose hash matches a queued file that is not stored yet follows that file instead."""

    def __init__(self, pool, model_manager):
        self.pool = pool
        self.model_manager = model_manager
        self.jobs = collections.deque()
        self.pending_by_hash = {}

    def __len__(self):
        return len(self.jobs)

    def add(self, filepath, file_hash, stored_id=None, followers=()):
        source = self.pending_by_hash.get(file_hash)
        if source is not None:
            source.followers.append((filepath, stored_id))
            source.followers.extend(followers)
            return
        future = self.pool.submit(_prepare_file, self.model_manager, filepath)
        job = _EmbedJob(filepath, file_hash, stored_id, future, followers)
        self.jobs.append(job)
        self.pending_by_hash[file_hash] = job

    def take(self, count):
        """The oldest jobs; waiting for their preprocessing is up to the caller."""
        return [self.jobs.popleft() for _ in range(min(count, len(self.jobs)))]

    def finish(self, job):
        """The job was stored or failed: later files with its hash no longer follow it."""
        if self.pending_by_hash.get(job.file_hash) is job:
            del self.pending_by_hash[job.file_hash]

    def cancel(self):
        for job in self.jobs:
            job.future.cancel()
        self.jobs.clear()
        self.pending_by_hash.clear()

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
        """Discover supported images and videos without decoding media files.
        Returns (image paths, video paths, {image path: (st_mtime_ns, st_size)}); an image whose stat failed
        is listed but has no stat entry."""
        image_files = []
        video_files = []
        image_stats = {}

        for directory in folder_paths:
            if self.cancel_requested:
                break
            if not os.path.isdir(directory):
                print(f"[Warning] Indexer: Skipping invalid directory {directory}")
                continue

            for root, file_entries in _walk_file_entries(directory):
                if self.cancel_requested:
                    break
                for entry in file_entries:
                    file_path = os.path.join(root, entry.name)
                    extension = os.path.splitext(entry.name)[1].lower()
                    if extension in IMAGE_EXTENSIONS:
                        image_files.append(file_path)
                        try:
                            stat = entry.stat()
                            image_stats[file_path] = (stat.st_mtime_ns, stat.st_size)
                        except OSError:
                            pass
                    elif extension in VIDEO_EXTENSIONS:
                        video_files.append(file_path)

        return image_files, video_files, image_stats

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

    def _record_failed_frame(self, path, timestamp, record_id, error):
        print(f"Error indexing video frame {record_id}: {error}")
        self.error_count += 1
        self.failed_files.append(f"{path} @ {timestamp:.2f}s")

    def _add_video_frame_batch(self, prepared, metadatas, record_ids, task_context=None):
        """Embed and store one batch of prepared video frames, falling back per frame on failure."""
        stored_count = 0
        try:
            embeddings = self.model_manager.embed_prepared(prepared, task_context=task_context)
            if embeddings:
                self.collection.add(
                    embeddings=embeddings,
                    metadatas=metadatas,
                    ids=record_ids
                )
                stored_count = len(record_ids)
        except Exception as e:
            print(f"Video frame batch embedding failed, falling back frame-by-frame: {e}")
            for item, metadata, record_id in zip(prepared, metadatas, record_ids):
                if task_context and not task_context.check_paused_or_cancelled():
                    break
                try:
                    embedding = self.model_manager.embed_prepared([item], task_context=task_context)
                    if embedding:
                        self.collection.add(
                            embeddings=[embedding[0]],
                            metadatas=[metadata],
                            ids=[record_id]
                        )
                        stored_count += 1
                except Exception as frame_error:
                    self._record_failed_frame(metadata["path"], metadata["timestamp_seconds"], record_id, frame_error)
        return stored_count

    def _index_video_file(self, filepath, source_signature, batch_size, task_context=None):
        """Extract and index adaptive scene-aware frames from one video. A producer thread decodes, thumbnails
        and preprocesses the frames while this thread embeds the batch before."""
        normalized_path = os.path.abspath(os.path.normpath(filepath))
        source_key = hashlib.sha256(normalized_path.lower().encode("utf-8")).hexdigest()
        stat = os.stat(normalized_path)
        pending_prepared = []
        pending_metadatas = []
        pending_ids = []
        attempted_ids = []
        stored_count = 0
        frames = queue.Queue(maxsize=2 * batch_size)
        stop = threading.Event()

        def should_cancel_fn():
            if stop.is_set() or self.cancel_requested:
                return True
            if task_context and not task_context.check_paused_or_cancelled():
                return True
            return False

        def hand_over(item):
            """Blocks while the queue is full; False once this thread stopped taking frames."""
            while not stop.is_set():
                try:
                    frames.put(item, timeout=0.2)
                    return True
                except queue.Full:
                    pass
            return False

        def produce():
            try:
                for timestamp, image, sampling_metadata in iter_video_frames(
                    normalized_path,
                    should_cancel=should_cancel_fn
                ):
                    try:
                        if should_cancel_fn():
                            break
                        # Save 480x480 thumbnail at indexing time for instant 0ms search lookup
                        save_video_frame_thumbnail(normalized_path, timestamp, image, self.video_cache_dir, stat)
                        try:
                            item = ("frame", timestamp, self.model_manager.prepare_image(image), sampling_metadata)
                        except Exception as e:
                            item = ("frame_error", timestamp, e, None)
                    finally:
                        image.close()
                    if not hand_over(item):
                        return
                hand_over(("end", None, None, None))
            except BaseException as e:
                hand_over(("error", None, e, None))

        producer = threading.Thread(target=produce, name="vblis-video-frames", daemon=True)
        producer.start()
        try:
            while True:
                kind, timestamp, payload, sampling_metadata = frames.get()
                if kind == "end":
                    break
                if kind == "error":
                    raise payload

                timestamp_ms = int(round(timestamp * 1000))
                record_id = f"video:{source_key}:{timestamp_ms}"
                if kind == "frame_error":
                    self._record_failed_frame(normalized_path, timestamp, record_id, payload)
                    continue
                frame_hash = hashlib.sha256(
                    f"{source_key}:{source_signature}:{timestamp_ms}".encode("utf-8")
                ).hexdigest()
                pending_prepared.append(payload)
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

                if len(pending_prepared) >= batch_size:
                    stored_count += self._add_video_frame_batch(
                        pending_prepared, pending_metadatas, pending_ids, task_context=task_context
                    )
                    pending_prepared, pending_metadatas, pending_ids = [], [], []

            if self.cancel_requested or (task_context and task_context.cancel_requested):
                if attempted_ids:
                    self.collection.delete(ids=attempted_ids)
                return 0

            if pending_prepared:
                stored_count += self._add_video_frame_batch(
                    pending_prepared, pending_metadatas, pending_ids, task_context=task_context
                )

            if stored_count == 0:
                raise ValueError("No decodable frames were found in the video.")
            return stored_count
        except Exception:
            if attempted_ids:
                try:
                    self.collection.delete(ids=attempted_ids)
                except Exception:
                    pass
            raise
        finally:
            stop.set()
            producer.join()

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

    def _stop_requested(self, task_context):
        return self.cancel_requested or bool(task_context and not task_context.check_paused_or_cancelled())

    def _advance_progress(self, filepath, task_context, count=1):
        self.indexed_files += count
        if task_context:
            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))

    def _record_failed_file(self, filepath, err, task_context):
        print(f"Error preparing {filepath}: {err}")
        self._count_failed_file(filepath, err, task_context)

    def _count_failed_file(self, filepath, err, task_context):
        self.error_count += 1
        self.failed_files.append(filepath)
        if task_context:
            task_context.add_error(f"{os.path.basename(filepath)}: {err}")
        self._advance_progress(filepath, task_context)

    @staticmethod
    def _stat_metadata(stats, filepath):
        stat = stats.get(filepath) if stats else None
        return {"mtime_ns": int(stat[0]), "size": int(stat[1])} if stat else {}

    @staticmethod
    def _image_record_metadata(filepath, file_hash, stat_metadata):
        return {"path": filepath, "hash": file_hash, "media_type": "image",
                "embed_version": IMAGE_EMBED_VERSION, **stat_metadata}

    @staticmethod
    def _split_unchanged_images(files, known, stats):
        """Splits files into (still to check, unchanged): a file is unchanged when its record is current and
        its size and mtime are those stored with the record, so it needs no hashing or any other file I/O."""
        pending = []
        unchanged = []
        for filepath in files:
            entry = known.get(filepath)
            stat = stats.get(filepath)
            if entry and stat:
                meta = entry[2]
                if (meta.get("embed_version", 1) >= IMAGE_EMBED_VERSION
                        and meta.get("mtime_ns") == stat[0] and meta.get("size") == stat[1]):
                    unchanged.append(filepath)
                    continue
            pending.append(filepath)
        return pending, unchanged

    def _classify_chunk(self, chunk_files, results, known, stats, task_context):
        """Sorts the inspected files of a chunk, in file order: failures are reported, files whose record is
        still right are finished (a stat or version change only queues a metadata update), the rest become
        candidates for an embedding, each with the stored record it replaces."""
        plan = _ChunkPlan()
        for filepath in chunk_files:
            _, file_hash, rotated, err = results[filepath]
            if err or not file_hash:
                self._record_failed_file(filepath, err, task_context)
                continue

            if known is not None and filepath in known:
                stat_metadata = self._stat_metadata(stats, filepath)
                stored_id, stored_hash, stored_meta = known[filepath]
                # If already in DB with same hash, skip
                if stored_hash == file_hash:
                    outdated = stored_meta.get("embed_version", 1) < IMAGE_EMBED_VERSION
                    if not (outdated and rotated):
                        if outdated:
                            # Same pixels as when it was embedded, so only the version mark is missing
                            plan.update_ids.append(stored_id)
                            plan.update_metas.append({**stored_meta, "embed_version": IMAGE_EMBED_VERSION, **stat_metadata})
                            plan.upgrades += 1
                        elif any(stored_meta.get(key) != value for key, value in stat_metadata.items()):
                            # Touched or copied without changing the bytes: remember the new size and mtime
                            plan.update_ids.append(stored_id)
                            plan.update_metas.append({**stored_meta, **stat_metadata})
                        self._advance_progress(filepath, task_context)
                        continue
                    # Embedded sideways before orientation was applied: handled like a changed file
                    plan.reembedded += 1
                # The stored record goes when the new embedding is stored (or the file fails), so a stopped run
                # leaves it in place
                plan.candidates.append((filepath, file_hash, rotated, stored_id))
                continue
            plan.candidates.append((filepath, file_hash, rotated, None))
        return plan

    def _max_write_batch(self):
        try:
            return max(1, int(self.client.get_max_batch_size()))
        except Exception:
            return 4096

    def _write_in_slices(self, write, ids, **columns):
        """Chroma rejects an add or update of more records than the client's max batch size: write in slices."""
        step = self._max_write_batch()
        for start in range(0, len(ids), step):
            write(ids=ids[start:start + step], **{key: values[start:start + step] for key, values in columns.items()})

    def _apply_record_updates(self, plan, label, task_context):
        """Writes the chunk's queued metadata updates. Returns how many version upgrades succeeded."""
        if not plan.update_ids:
            return 0
        try:
            self._write_in_slices(self.collection.update, plan.update_ids, metadatas=plan.update_metas)
            return plan.upgrades
        except Exception as e:
            print(f"Error upgrading index records during {label.lower()}: {e}")
            if task_context:
                task_context.add_error(f"Index record upgrade failed: {e}")
            return 0

    def _delete_records(self, record_ids):
        if not record_ids:
            return
        try:
            self.collection.delete(ids=record_ids)
        except Exception:
            pass

    def _find_reusable_embeddings(self, hashes):
        """One bulk ChromaDB query: {hash: (stored embedding, record is current)} for the hashes already indexed."""
        existing_hash_map = {}
        try:
            db_hits = self.collection.get(
                where={"hash": {"$in": list(set(hashes))}},
                include=["embeddings", "metadatas"]
            )
            if db_hits and db_hits.get("metadatas"):
                for meta, emb in zip(db_hits["metadatas"], db_hits["embeddings"]):
                    if meta and "hash" in meta and emb is not None and len(emb) > 0:
                        current = meta.get("embed_version", 1) >= IMAGE_EMBED_VERSION
                        # Several records can share a hash: prefer one embedded the current way
                        if meta["hash"] not in existing_hash_map or (current and not existing_hash_map[meta["hash"]][1]):
                            existing_hash_map[meta["hash"]] = (emb, current)
        except Exception:
            pass
        return existing_hash_map

    def _add_reused_embeddings(self, reused, stats, task_context):
        """Stores (path, hash, embedding, replaced record id) records that copy an already computed embedding,
        in one add, after deleting the records they replace (a new id can equal a stored one)."""
        self._delete_records([stored_id for _, _, _, stored_id in reused if stored_id is not None])
        ids = [filepath for filepath, _, _, _ in reused]
        metadatas = [
            self._image_record_metadata(filepath, file_hash, self._stat_metadata(stats, filepath))
            for filepath, file_hash, _, _ in reused
        ]
        try:
            self._write_in_slices(self.collection.add, ids, embeddings=[emb for _, _, emb, _ in reused], metadatas=metadatas)
        except Exception as e:
            print(f"Batch add of reused embeddings failed, falling back to one by one: {e}")
            for (filepath, _, embedding, _), metadata in zip(reused, metadatas):
                try:
                    self.collection.add(embeddings=[embedding], metadatas=[metadata], ids=[filepath])
                except Exception as ex:
                    print(f"Error adding reused embedding for {filepath}: {ex}")
                    if task_context:
                        task_context.add_error(f"{os.path.basename(filepath)}: {ex}")
        self._advance_progress(ids[-1], task_context, count=len(ids))

    def _store_embedded(self, pairs, embed_queue, stats, task_context):
        """Stores (job, embedding) pairs, each job together with its followers, after deleting the records they
        replace (a new id can equal a stored one)."""
        ids, metadatas, embeddings, replaced = [], [], [], []
        for job, embedding in pairs:
            for filepath, stored_id in [(job.filepath, job.stored_id)] + job.followers:
                ids.append(filepath)
                metadatas.append(self._image_record_metadata(filepath, job.file_hash, self._stat_metadata(stats, filepath)))
                embeddings.append(embedding)
                if stored_id is not None:
                    replaced.append(stored_id)
        self._delete_records(replaced)
        self._write_in_slices(self.collection.add, ids, embeddings=embeddings, metadatas=metadatas)
        for job, _ in pairs:
            embed_queue.finish(job)
        self._advance_progress(ids[-1], task_context, count=len(ids))

    def _fail_job(self, job, err, embed_queue, task_context):
        """Counts a queued file as failed; a changed file loses its outdated record, as before. Its followers get
        their own attempt instead of copying nothing."""
        embed_queue.finish(job)
        if job.stored_id is not None:
            self._delete_records([job.stored_id])
        self._count_failed_file(job.filepath, err, task_context)
        if job.followers:
            (filepath, stored_id), rest = job.followers[0], job.followers[1:]
            embed_queue.add(filepath, job.file_hash, stored_id, rest)

    @staticmethod
    def _is_rotated(filepath, rotated):
        """rotated as inspected, or read now when it was not needed before. A file whose orientation cannot be read
        counts as rotated, so it never copies an embedding that was made without orientation."""
        if rotated is not None:
            return rotated
        try:
            return read_rotated(filepath)
        except Exception:
            return True

    def _embed_next_batch(self, embed_queue, batch_size, stats, label, task_context):
        """Embeds the oldest queued files as one GPU batch, falling back to one file at a time."""
        ready = []
        for job in embed_queue.take(batch_size):
            prepared, err = job.future.result()
            if prepared is None:
                print(f"Error preparing {job.filepath}: {err}")
                self._fail_job(job, err, embed_queue, task_context)
            else:
                ready.append((job, prepared))
        if not ready:
            return
        try:
            embeddings = self.model_manager.embed_prepared([prepared for _, prepared in ready], task_context=task_context)
            if embeddings:
                # Fewer embeddings than files only when stopped half-way: those are left out
                self._store_embedded(list(zip([job for job, _ in ready], embeddings)), embed_queue, stats, task_context)
        except Exception as e:
            print(f"Batch embedding failed during {label.lower()}, falling back to item-by-item: {e}")
            for job, prepared in ready:
                if self._stop_requested(task_context):
                    break
                try:
                    embedding = self.model_manager.embed_prepared([prepared], task_context=task_context)
                    if embedding:
                        self._store_embedded([(job, embedding[0])], embed_queue, stats, task_context)
                except Exception as ex:
                    print(f"Error in {label.lower()} item fallback {job.filepath}: {ex}")
                    self._fail_job(job, ex, embed_queue, task_context)

    def _index_image_files(self, files, task_context=None, known=None, label="Indexing", stats=None):
        """Embed and store image files (shared by index and reindex).
        known=None (index): files are the pending ones and are all added.
        known={normalized path: (stored record id, stored hash, stored metadata)} (reindex): a file whose hash
        is unchanged is skipped, a changed one has its stored record deleted before it is added again.
        A record from before IMAGE_EMBED_VERSION (embedded without EXIF orientation) keeps its embedding and
        only gets its metadata upgraded, unless the file is rotated: then it is embedded again.
        stats={path as in files: (st_mtime_ns, st_size)} is stored with every record written. On reindex a
        current record whose stored size and mtime match is trusted without even hashing the file.
        Only files that really need an embedding are decoded; a file whose hash is already indexed, or queued
        earlier in this run, copies that embedding.
        The work is pipelined: a pool hashes the files ahead of this thread, which sorts them a chunk at a time
        and queues the ones that need the GPU; a smaller pool decodes and preprocesses those while the GPU
        embeds the batch before.
        Returns (records with upgraded metadata, rotated records embedded again).
        """
        upgraded_count = 0
        reembedded_count = 0
        stats = stats or {}
        batch_size = self.model_manager.get_effective_batch_size()
        max_workers = min(16, max(2, (os.cpu_count() or 4)))
        decode_workers = min(max_workers, _DECODE_WORKERS)
        # How many files may be queued for the GPU (being decoded, or ready) before the oldest batch is embedded
        queue_limit = max(2 * batch_size, 2 * decode_workers)

        if known is not None:
            files, unchanged = self._split_unchanged_images(files, known, stats)
            if unchanged:
                self._advance_progress(unchanged[-1], task_context, count=len(unchanged))
        if not files:
            return upgraded_count, reembedded_count

        def inspect(filepath):
            # The orientation only decides something for records from before IMAGE_EMBED_VERSION, and reading it
            # can cost a full decode (PNG), so it is read up front only for those
            entry = known.get(filepath) if known is not None else None
            outdated = entry is not None and entry[2].get("embed_version", 1) < IMAGE_EMBED_VERSION
            return inspect_file(filepath, orientation=outdated)

        stopped = False
        with ThreadPoolExecutor(max_workers=max_workers) as inspect_pool, \
                ThreadPoolExecutor(max_workers=decode_workers) as decode_pool:
            embed_queue = _EmbedQueue(decode_pool, self.model_manager)
            # 1. File hashing and EXIF orientation from the header (no pixel decoding) run ahead in the pool
            inspected = _ordered_results(inspect_pool, inspect, files, 4 * max_workers)
            try:
                for chunk in _chunked(inspected, batch_size):
                    if self._stop_requested(task_context):
                        stopped = True
                        break
                    chunk_files = [filepath for filepath, _ in chunk]
                    self.current_file = chunk_files[0]
                    if task_context:
                        task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(self.current_file))

                    # 2. Sort the chunk and write its record updates
                    plan = self._classify_chunk(chunk_files, dict(chunk), known, stats, task_context)
                    reembedded_count += plan.reembedded
                    upgraded_count += self._apply_record_updates(plan, label, task_context)

                    # 3. Content that is already indexed is copied in one add; the rest is queued for the GPU
                    if plan.candidates:
                        existing_hash_map = self._find_reusable_embeddings([file_hash for _, file_hash, _, _ in plan.candidates])
                        reused = []
                        for filepath, file_hash, rotated, stored_id in plan.candidates:
                            hit = existing_hash_map.get(file_hash)
                            # A stored embedding made without orientation is only right for a file that is not rotated
                            if hit and (hit[1] or not self._is_rotated(filepath, rotated)):
                                reused.append((filepath, file_hash, hit[0], stored_id))
                            else:
                                embed_queue.add(filepath, file_hash, stored_id)
                        if reused:
                            self._add_reused_embeddings(reused, stats, task_context)

                    # 4. Embed the oldest batches while the pools work ahead, so the queue stays bounded
                    while len(embed_queue) >= queue_limit:
                        if self._stop_requested(task_context):
                            stopped = True
                            break
                        self._embed_next_batch(embed_queue, batch_size, stats, label, task_context)
                    if stopped:
                        break

                while not stopped and len(embed_queue):
                    if self._stop_requested(task_context):
                        stopped = True
                        break
                    self._embed_next_batch(embed_queue, batch_size, stats, label, task_context)
            finally:
                inspected.close()
                embed_queue.cancel()

        if stopped:
            print(f"[Notice] {label} cancelled by user.")
        return upgraded_count, reembedded_count

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
            files_to_index, discovered_videos, image_stats = self.discover_media_files(folder_paths)
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

            self._index_image_files(pending_files, task_context=task_context, label="Indexing", stats=image_stats)

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
            discovered_images, discovered_videos, image_stats = self.discover_media_files([directory])
            disk_files = [os.path.normpath(path) for path in discovered_images]
            disk_video_files = [os.path.normpath(path) for path in discovered_videos]
            disk_stats = {os.path.normpath(path): stat for path, stat in image_stats.items()}
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
                                "media_type": meta.get("media_type", "image"),
                                "meta": dict(meta)
                            })

            db_image_entries = [e for e in db_entries if e["media_type"] != "video"]
            known = {e["path"]: (e["id"], e["hash"], e["meta"]) for e in db_image_entries}
            # A record is stale when the scan did not find its file and the file is really gone (one stat per
            # undiscovered record only, so an unreadable subfolder cannot drop its records)
            discovered_keys = {os.path.normcase(path) for path in disk_files + disk_video_files}
            stale_entries = [
                e for e in db_entries
                if os.path.normcase(e["path"]) not in discovered_keys and not os.path.exists(e["path"])
            ]
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
            upgraded_count, reembedded_count = self._index_image_files(
                disk_files, task_context=task_context, known=known, label="Re-indexing", stats=disk_stats
            )
            if upgraded_count or reembedded_count:
                print(
                    f"Re-index of {directory}: {upgraded_count} records upgraded without re-embedding, "
                    f"{reembedded_count} rotated images embedded again with their orientation applied"
                )

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
