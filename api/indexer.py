import os
import hashlib
from PIL import Image
import pillow_heif
import chromadb
import sqlite3
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from model_manager import ModelManager

pillow_heif.register_heif_opener()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
VIDEO_SAMPLING_VERSION = "adaptive-v1"
VIDEO_ANALYSIS_INTERVAL_SECONDS = 0.5
VIDEO_MAX_SAMPLE_GAP_SECONDS = 5.0
VIDEO_MIN_SAMPLE_GAP_SECONDS = 0.5
VIDEO_SCENE_PIXEL_THRESHOLD = 0.16
VIDEO_SCENE_HISTOGRAM_THRESHOLD = 0.42
VIDEO_DUPLICATE_PIXEL_THRESHOLD = 0.035
VIDEO_DUPLICATE_HISTOGRAM_THRESHOLD = 0.12

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

def get_video_signature(filepath):
    """Return a cheap signature that changes with the video or sampling strategy."""
    stat = os.stat(filepath)
    sampling_signature = ":".join(str(value) for value in (
        VIDEO_SAMPLING_VERSION,
        VIDEO_ANALYSIS_INTERVAL_SECONDS,
        VIDEO_MAX_SAMPLE_GAP_SECONDS,
        VIDEO_MIN_SAMPLE_GAP_SECONDS,
        VIDEO_SCENE_PIXEL_THRESHOLD,
        VIDEO_SCENE_HISTOGRAM_THRESHOLD,
        VIDEO_DUPLICATE_PIXEL_THRESHOLD,
        VIDEO_DUPLICATE_HISTOGRAM_THRESHOLD
    ))
    return f"{stat.st_mtime_ns}:{stat.st_size}:{sampling_signature}"

def extract_video_frame(filepath, timestamp_seconds):
    """Decode one RGB video frame at or immediately after the requested timestamp."""
    capture = cv2.VideoCapture(filepath)
    try:
        if not capture.isOpened():
            raise ValueError("Video could not be opened.")
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp_seconds) * 1000.0)
        success, frame = capture.read()
        if not success or frame is None:
            # Fallback to start of video if requested timestamp is past the end of a short clip
            capture.set(cv2.CAP_PROP_POS_MSEC, 0.0)
            success, frame = capture.read()
            if not success or frame is None:
                raise ValueError(f"Video frame could not be decoded at {timestamp_seconds:.2f}s.")
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(frame)
    finally:
        capture.release()

def _build_frame_descriptor(frame):
    """Build a small spatial and color descriptor for inexpensive frame comparison."""
    reduced = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
    grayscale = cv2.cvtColor(reduced, cv2.COLOR_BGR2GRAY)
    grayscale = cv2.GaussianBlur(grayscale, (5, 5), 0)
    hsv = cv2.cvtColor(reduced, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
    cv2.normalize(histogram, histogram)
    return grayscale, histogram


def _compare_frame_descriptors(first, second):
    """Return normalized spatial and color differences between two descriptors."""
    pixel_difference = cv2.mean(cv2.absdiff(first[0], second[0]))[0] / 255.0
    histogram_difference = cv2.compareHist(
        first[1], second[1], cv2.HISTCMP_BHATTACHARYYA
    )
    return float(pixel_difference), float(histogram_difference)


def _iter_video_analysis_frames(capture, fps, frame_count, analysis_interval_seconds):
    """Yield low-frequency source frames used by the adaptive selector."""
    duration = frame_count / fps if fps > 0 and frame_count > 0 else 0

    if duration > 0:
        timestamp = 0.0
        while timestamp < duration:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            success, frame = capture.read()
            if success and frame is not None:
                yield timestamp, frame
            timestamp += analysis_interval_seconds
        return

    fallback_fps = fps if fps > 0 else 30.0
    analyze_every = max(1, round(fallback_fps * analysis_interval_seconds))
    frame_index = 0
    while True:
        success, frame = capture.read()
        if not success or frame is None:
            break
        if frame_index % analyze_every == 0:
            yield frame_index / fallback_fps, frame
        frame_index += 1


def iter_video_frames(
    filepath,
    analysis_interval_seconds=VIDEO_ANALYSIS_INTERVAL_SECONDS,
    should_cancel=None
):
    """Yield scene-aware, de-duplicated PIL frames without modifying the video."""
    capture = cv2.VideoCapture(filepath)
    try:
        if not capture.isOpened():
            raise ValueError("Video could not be opened.")

        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        previous_descriptor = None
        last_selected_descriptor = None
        last_selected_timestamp = None
        scene_id = 0

        for timestamp, frame in _iter_video_analysis_frames(
            capture, fps, frame_count, analysis_interval_seconds
        ):
            if should_cancel and should_cancel():
                break

            descriptor = _build_frame_descriptor(frame)
            scene_changed = False
            scene_score = 0.0

            if previous_descriptor is not None:
                pixel_difference, histogram_difference = _compare_frame_descriptors(
                    previous_descriptor, descriptor
                )
                scene_changed = (
                    pixel_difference >= VIDEO_SCENE_PIXEL_THRESHOLD
                    or histogram_difference >= VIDEO_SCENE_HISTOGRAM_THRESHOLD
                )
                scene_score = max(
                    pixel_difference / VIDEO_SCENE_PIXEL_THRESHOLD,
                    histogram_difference / VIDEO_SCENE_HISTOGRAM_THRESHOLD
                )
                if scene_changed:
                    scene_id += 1

            elapsed_since_selection = (
                float("inf")
                if last_selected_timestamp is None
                else timestamp - last_selected_timestamp
            )
            is_first_frame = last_selected_descriptor is None
            is_scene_candidate = (
                scene_changed
                and elapsed_since_selection >= VIDEO_MIN_SAMPLE_GAP_SECONDS
            )
            is_interval_candidate = elapsed_since_selection >= VIDEO_MAX_SAMPLE_GAP_SECONDS
            should_select = is_first_frame or is_scene_candidate or is_interval_candidate

            if should_select and last_selected_descriptor is not None:
                selected_pixel_difference, selected_histogram_difference = (
                    _compare_frame_descriptors(last_selected_descriptor, descriptor)
                )
                is_near_duplicate = (
                    selected_pixel_difference <= VIDEO_DUPLICATE_PIXEL_THRESHOLD
                    and selected_histogram_difference <= VIDEO_DUPLICATE_HISTOGRAM_THRESHOLD
                )
                if is_near_duplicate:
                    should_select = False

            if should_select:
                if is_first_frame:
                    sampling_reason = "first_frame"
                elif is_scene_candidate:
                    sampling_reason = "scene_change"
                else:
                    sampling_reason = "max_gap"

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                yield timestamp, Image.fromarray(rgb_frame), {
                    "scene_id": scene_id,
                    "sampling_reason": sampling_reason,
                    "scene_change_score": float(scene_score)
                }
                last_selected_descriptor = descriptor
                last_selected_timestamp = timestamp

            previous_descriptor = descriptor
    finally:
        capture.release()

class Indexer:
    def __init__(self, model_manager: ModelManager, db_path=None):
        if db_path is None:
            # Always put the db relative to this python file inside the api folder
            db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_data")
            
        self.model_manager = model_manager
        self.client = chromadb.PersistentClient(path=db_path)
        self.collection = None
        self.selected_folders_by_collection = {}
        
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

    def _get_selected_folders(self):
        if not self.collection:
            return set()
        return self.selected_folders_by_collection.setdefault(self.collection.name, set())

    def clear_collection(self):
        """Wipe all data from the active collection."""
        if self.collection:
            collection_name = self.collection.name
            print(f"Clearing collection: {collection_name}")
            self.client.delete_collection(name=collection_name)
            self.selected_folders_by_collection.pop(collection_name, None)
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
            self.selected_folders_by_collection.pop(collection_name, None)
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

            for selected_folder in self._get_selected_folders():
                nested_folders = [
                    path for path in folders_map
                    if path == selected_folder or path.startswith(selected_folder + os.sep)
                ]
                for nested_folder in nested_folders:
                    folders_map.pop(nested_folder, None)
                folders_map[selected_folder] = os.path.isdir(selected_folder)
            
            # Return as list of dictionaries
            output = [{"path": p, "exists": e} for p, e in folders_map.items()]
            return sorted(output, key=lambda x: x["path"])
        except Exception as e:
            print(f"Error getting indexed folders: {e}")
            return []

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

    def get_folder_contents(self, folder_path: str, limit: int = 5000):
        """List supported media in a folder without indexing or decoding it."""
        if not os.path.isdir(folder_path):
            raise ValueError("Folder does not exist or is not accessible.")

        normalized_folder = os.path.abspath(os.path.normpath(folder_path))
        items = []
        image_count = 0
        video_count = 0
        truncated = False

        for root, _, files in os.walk(normalized_folder):
            for file in files:
                extension = os.path.splitext(file)[1].lower()
                if extension not in IMAGE_EXTENSIONS and extension not in VIDEO_EXTENSIONS:
                    continue

                file_path = os.path.join(root, file)
                media_type = "image" if extension in IMAGE_EXTENSIONS else "video"

                try:
                    stat = os.stat(file_path)
                except OSError:
                    continue

                if media_type == "image":
                    image_count += 1
                else:
                    video_count += 1

                if len(items) < limit:
                    items.append({
                        "name": file,
                        "path": file_path,
                        "relative_path": os.path.relpath(file_path, normalized_folder),
                        "media_type": media_type,
                        "extension": extension,
                        "size": stat.st_size,
                        "modified_at": stat.st_mtime
                    })
                else:
                    truncated = True

        items.sort(key=lambda item: item["relative_path"].lower())
        return {
            "folder_path": normalized_folder,
            "items": items,
            "image_count": image_count,
            "video_count": video_count,
            "total_count": image_count + video_count,
            "truncated": truncated,
            "limit": limit
        }

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
                grouped.setdefault(source_path, []).append({
                    "id": record_id,
                    "source_signature": metadata.get("source_signature")
                })
        return grouped

    def _add_video_frame_batch(self, images, metadatas, record_ids):
        """Embed and store one video-frame batch, falling back per frame on failure."""
        stored_count = 0
        try:
            embeddings = self.model_manager.get_image_embeddings_batch(images)
            self.collection.add(
                embeddings=embeddings,
                metadatas=metadatas,
                ids=record_ids
            )
            stored_count = len(record_ids)
        except Exception as e:
            print(f"Video frame batch embedding failed, falling back frame-by-frame: {e}")
            for image, metadata, record_id in zip(images, metadatas, record_ids):
                try:
                    embedding = self.model_manager.get_image_embedding(image)
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

    def _index_video_file(self, filepath, source_signature, batch_size):
        """Extract and index adaptive scene-aware frames from one video."""
        normalized_path = os.path.abspath(os.path.normpath(filepath))
        source_key = hashlib.sha256(normalized_path.lower().encode("utf-8")).hexdigest()
        pending_images = []
        pending_metadatas = []
        pending_ids = []
        attempted_ids = []
        stored_count = 0

        try:
            for timestamp, image, sampling_metadata in iter_video_frames(
                normalized_path,
                should_cancel=lambda: self.cancel_requested
            ):
                if self.cancel_requested:
                    image.close()
                    break

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
                        pending_images, pending_metadatas, pending_ids
                    )
                    pending_images, pending_metadatas, pending_ids = [], [], []

            if self.cancel_requested:
                for image in pending_images:
                    image.close()
                if attempted_ids:
                    self.collection.delete(ids=attempted_ids)
                return 0

            if pending_images:
                stored_count += self._add_video_frame_batch(
                    pending_images, pending_metadatas, pending_ids
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

    def _index_video_files(self, video_files, existing_video_entries=None):
        """Index new or changed videos while preserving unchanged frame records."""
        existing_video_entries = existing_video_entries or {}
        batch_size = self.model_manager.get_effective_batch_size()

        for filepath in video_files:
            if self.cancel_requested:
                break

            normalized_path = os.path.abspath(os.path.normpath(filepath))
            self.current_file = normalized_path
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
                    normalized_path, source_signature, batch_size
                )
                self.indexed_video_frames += frame_count
            except Exception as e:
                print(f"Error indexing video {normalized_path}: {e}")
                self.error_count += 1
                self.failed_files.append(normalized_path)
            finally:
                self.indexed_files += 1

    def delete_folder_index(self, folder_path: str):
        """Delete all index entries belonging to a specific folder."""
        if not self._ensure_collection():
            return 0
            
        try:
            # We want to delete all files that are in this folder or its subfolders
            # Normalizing folder_path to ensure correct matching
            norm_folder = os.path.normpath(folder_path)
            self._get_selected_folders().discard(norm_folder)
            
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
            "indexed_video_frames": self.indexed_video_frames
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
        self.discovered_video_count = 0
        self.indexed_video_frames = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        # Ensure collection is set
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())

        selected_folders = self._get_selected_folders()
        for folder_path in folder_paths:
            if os.path.isdir(folder_path):
                selected_folders.add(os.path.abspath(os.path.normpath(folder_path)))
            
        self.failed_files = []
        
        try:
            files_to_index, discovered_videos = self.discover_media_files(folder_paths)
            self.discovered_video_count = len(discovered_videos)
            self.total_files = len(files_to_index) + len(discovered_videos)
            
            # Get existing IDs (paths) to avoid redundant work
            existing_results = self.collection.get(include=["metadatas"])
            existing_ids = set(existing_results["ids"]) if existing_results and "ids" in existing_results else set()
            existing_video_entries = self._get_existing_video_entries(existing_results)
            
            # Filter out already indexed files
            pending_files = [f for f in files_to_index if f not in existing_ids]
            self.indexed_files = len(files_to_index) - len(pending_files)

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
                                metadatas=[{"path": filepath, "hash": file_hash, "media_type": "image"}],
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
                        valid_metas.append({"path": filepath, "hash": file_hash, "media_type": "image"})
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

            self._index_video_files(discovered_videos, existing_video_entries)
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
        self.discovered_video_count = 0
        self.indexed_video_frames = 0
        self.model_manager.oom_triggered = False
        self.model_manager.oom_triggered_count = 0
        
        if not self.collection:
            self.switch_collection(self.model_manager.get_collection_name())

        self._get_selected_folders().add(os.path.abspath(os.path.normpath(directory)))
            
        self.failed_files = []
        
        try:
            norm_target = os.path.normpath(directory)

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
            db_paths = {e["path"] for e in db_image_entries}
            db_hashes_by_path = {e["path"]: e["hash"] for e in db_image_entries}
            stale_entries = [e for e in db_entries if not os.path.exists(e["path"])]
            stale_source_paths = {e["path"] for e in stale_entries}
            existing_video_entries = self._get_existing_video_entries(results)

            self.total_files = len(disk_files) + len(disk_video_files) + len(stale_source_paths)
            
            # 3. Remove entries from DB that are no longer on disk
            ids_to_remove = [entry["id"] for entry in stale_entries]
            
            if ids_to_remove:
                print(f"Removing {len(ids_to_remove)} dead entries from index for {directory}")
                self.collection.delete(ids=ids_to_remove)
                self.run_maintenance()
            
            # Update progress
            self.indexed_files = len(stale_source_paths)
            
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
                                metadatas=[{"path": filepath, "hash": file_hash, "media_type": "image"}],
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
                        valid_metas.append({"path": filepath, "hash": file_hash, "media_type": "image"})
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

            if not self.cancel_requested:
                self._index_video_files(disk_video_files, existing_video_entries)
                
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
                    "id": results["ids"][0][i],
                    "path": filepath,
                    "hash": file_hash,
                    "media_type": meta.get("media_type", "image") if meta else "image",
                    "timestamp_seconds": meta.get("timestamp_seconds") if meta else None,
                    "scene_id": meta.get("scene_id") if meta else None,
                    "sampling_reason": meta.get("sampling_reason") if meta else None,
                    "score": float(score),
                    "embedding": emb
                })
            
        return formatted_results
