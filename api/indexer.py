import os
import json
import hashlib
from PIL import Image
import pillow_heif
import chromadb
import sqlite3
import cv2
import av
from av.codec.hwaccel import hwdevices_available, HWAccel
from concurrent.futures import ThreadPoolExecutor, as_completed
from model_manager import ModelManager
import pathlib

pillow_heif.register_heif_opener()
try:
    av.logging.set_level(av.logging.ERROR)
except Exception:
    pass

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
VIDEO_SAMPLING_VERSION = "adaptive-v3"
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

def open_video_cascade(filepath):
    """Open video using a 3-stage cascading hardware acceleration pipeline:
    Stage 1: iGPU priority (D3D11VA / QSV) - preserves dGPU VRAM for AI models.
    Stage 2: dGPU secondary (CUDA / DXVA2 / D3D12VA / AMF) - discrete GPU hardware decode.
    Stage 3: CPU software decoding (libavcodec) - universal safety net for exotic/old codecs.
    """
    try:
        available_hw = set(hwdevices_available())
    except Exception:
        available_hw = set()

    # Stage 1: iGPU priority (D3D11VA, QSV)
    for target in ["d3d11va", "qsv"]:
        if target in available_hw:
            try:
                hw = HWAccel(target)
                container = av.open(filepath, hwaccel=hw)
                if container.streams.video:
                    stream = container.streams.video[0]
                    # Verify decoder works by decoding first frame
                    for frame in container.decode(stream):
                        container.seek(0)
                        return container, stream, f"hw-{target} (iGPU priority)"
                    container.close()
            except Exception:
                pass

    # Stage 2: dGPU secondary (CUDA, DXVA2, D3D12VA, AMF)
    for target in ["cuda", "dxva2", "d3d12va", "amf"]:
        if target in available_hw:
            try:
                hw = HWAccel(target)
                container = av.open(filepath, hwaccel=hw)
                if container.streams.video:
                    stream = container.streams.video[0]
                    for frame in container.decode(stream):
                        container.seek(0)
                        return container, stream, f"hw-{target} (dGPU secondary)"
                    container.close()
            except Exception:
                pass

    # Stage 3: Universal CPU Software Decoding Fallback
    try:
        container = av.open(filepath)
        if container.streams.video:
            stream = container.streams.video[0]
            return container, stream, "cpu-software (fallback)"
    except Exception as e:
        raise ValueError(f"Video could not be opened: {e}")

CACHE_DIR = pathlib.Path(__file__).parent.resolve() / "cache"
IMAGE_CACHE_DIR = CACHE_DIR / "images"
VIDEO_CACHE_DIR = CACHE_DIR / "videos"
CACHE_DIR.mkdir(exist_ok=True)
IMAGE_CACHE_DIR.mkdir(exist_ok=True)
VIDEO_CACHE_DIR.mkdir(exist_ok=True)

def format_bytes(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

def get_cache_stats() -> dict:
    """Scan segregated cache subdirectories and return counts and sizes."""
    def scan_dir(dir_path: pathlib.Path):
        count = 0
        total_size = 0
        if dir_path.exists() and dir_path.is_dir():
            for f in dir_path.glob("*.jpg"):
                if f.is_file():
                    try:
                        count += 1
                        total_size += f.stat().st_size
                    except Exception:
                        pass
        return count, total_size

    img_count, img_size = scan_dir(IMAGE_CACHE_DIR)
    vid_count, vid_size = scan_dir(VIDEO_CACHE_DIR)
    
    # Also check legacy files in root CACHE_DIR
    if CACHE_DIR.exists() and CACHE_DIR.is_dir():
        for f in CACHE_DIR.glob("*.jpg"):
            if f.is_file():
                try:
                    s = f.stat().st_size
                    if "_video_frame.jpg" in f.name:
                        vid_count += 1
                        vid_size += s
                    else:
                        img_count += 1
                        img_size += s
                except Exception:
                    pass

    return {
        "images": {
            "count": img_count,
            "bytes": img_size,
            "formatted": format_bytes(img_size)
        },
        "videos": {
            "count": vid_count,
            "bytes": vid_size,
            "formatted": format_bytes(vid_size)
        },
        "total": {
            "count": img_count + vid_count,
            "bytes": img_size + vid_size,
            "formatted": format_bytes(img_size + vid_size)
        }
    }

def safe_clear_cache(target: str = "all") -> dict:
    """Safely delete generated .jpg thumbnails in segregated cache folders without touching non-cache files."""
    targets = []
    if target in ("images", "all"):
        targets.append(IMAGE_CACHE_DIR)
    if target in ("videos", "all"):
        targets.append(VIDEO_CACHE_DIR)

    deleted_files = 0
    bytes_reclaimed = 0

    for dir_path in targets:
        if not dir_path.exists() or not dir_path.is_dir():
            continue
        try:
            dir_path.resolve().relative_to(CACHE_DIR.resolve())
        except ValueError:
            print(f"Safety violation: {dir_path} is outside {CACHE_DIR}")
            continue

        for item in dir_path.glob("*.jpg"):
            if item.is_file():
                try:
                    if len(item.name) >= 32:
                        size = item.stat().st_size
                        item.unlink(missing_ok=True)
                        deleted_files += 1
                        bytes_reclaimed += size
                except Exception as e:
                    print(f"Error unlinking cache item {item}: {e}")

    # If target is "all" or "images"/"videos", also clean matching legacy files in root CACHE_DIR
    if CACHE_DIR.exists() and CACHE_DIR.is_dir():
        for item in CACHE_DIR.glob("*.jpg"):
            if item.is_file():
                try:
                    is_vid = "_video_frame.jpg" in item.name
                    if (target == "all") or (target == "videos" and is_vid) or (target == "images" and not is_vid):
                        size = item.stat().st_size
                        item.unlink(missing_ok=True)
                        deleted_files += 1
                        bytes_reclaimed += size
                except Exception as e:
                    print(f"Error unlinking legacy cache item {item}: {e}")

    return {
        "target": target,
        "deleted_files": deleted_files,
        "bytes_reclaimed": bytes_reclaimed,
        "formatted": format_bytes(bytes_reclaimed)
    }

def get_video_frame_cache_path(filepath: str, timestamp_seconds: float, cache_dir: pathlib.Path = None, stat=None) -> pathlib.Path:
    if stat is None:
        stat = os.stat(filepath)
    cache_key = hashlib.sha256(
        f"{os.path.abspath(filepath)}:{stat.st_mtime_ns}:{stat.st_size}:{float(timestamp_seconds):.3f}".encode("utf-8")
    ).hexdigest()
    
    target_path = VIDEO_CACHE_DIR / f"{cache_key}_video_frame.jpg"
    if target_path.exists():
        return target_path

    # Check legacy path in root cache dir and migrate if found
    legacy_path = CACHE_DIR / f"{cache_key}_video_frame.jpg"
    if legacy_path.exists():
        try:
            VIDEO_CACHE_DIR.mkdir(exist_ok=True)
            legacy_path.replace(target_path)
            return target_path
        except Exception:
            return legacy_path

    return target_path

def save_video_frame_thumbnail(filepath: str, timestamp_seconds: float, image: Image.Image, cache_dir: pathlib.Path = None, stat=None):
    """Save a 480x480 thumbnail directly from an in-memory PIL image into videos cache without extra decoding."""
    try:
        VIDEO_CACHE_DIR.mkdir(exist_ok=True)
        out_path = get_video_frame_cache_path(filepath, timestamp_seconds, VIDEO_CACHE_DIR, stat)
        if not out_path.exists():
            thumb = image.copy()
            thumb.thumbnail((480, 480))
            thumb.convert("RGB").save(out_path, format="JPEG", quality=78, optimize=True)
            thumb.close()
    except Exception as e:
        print(f"Failed to cache index-time video thumbnail for {filepath} at {timestamp_seconds}s: {e}")

def extract_video_frame(filepath, timestamp_seconds):
    """Decode one RGB video frame at or immediately after the requested timestamp."""
    try:
        container, stream, _ = open_video_cascade(filepath)
        try:
            target_sec = max(0.0, float(timestamp_seconds))
            time_base = float(stream.time_base) if stream.time_base else 0.001
            target_pts = int(round(target_sec / time_base))
            
            try:
                container.seek(target_pts, stream=stream, backward=True)
            except Exception:
                container.seek(0)

            closest_frame = None
            for frame in container.decode(stream):
                frame_ts = float(frame.pts * stream.time_base) if (frame.pts is not None and stream.time_base) else 0.0
                closest_frame = frame
                if frame_ts >= target_sec - 0.05:
                    break

            if closest_frame is None:
                container.seek(0)
                for frame in container.decode(stream):
                    closest_frame = frame
                    break

            if closest_frame is not None:
                bgr_arr = closest_frame.to_ndarray(format="bgr24")
                rgb_arr = cv2.cvtColor(bgr_arr, cv2.COLOR_BGR2RGB)
                return Image.fromarray(rgb_arr)
        finally:
            container.close()
    except Exception:
        pass

    # Fallback to OpenCV if PyAV extraction fails
    capture = cv2.VideoCapture(filepath)
    try:
        if not capture.isOpened():
            raise ValueError("Video could not be opened.")
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp_seconds) * 1000.0)
        success, frame = capture.read()
        if not success or frame is None:
            capture.set(cv2.CAP_PROP_POS_MSEC, 0.0)
            success, frame = capture.read()
            if not success or frame is None:
                raise ValueError(f"Video frame could not be decoded at {timestamp_seconds:.2f}s.")
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(frame)
    finally:
        capture.release()

def extract_video_frames_batch(filepath: str, timestamps: list, cache_dir: pathlib.Path, on_frame_saved=None):
    """Extract and cache multiple video frame thumbnails in a single sequential decode pass."""
    if not os.path.isfile(filepath) or not timestamps:
        return []

    cache_dir = pathlib.Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    stat = os.stat(filepath)

    uncached_ts = []
    for ts in timestamps:
        p = get_video_frame_cache_path(filepath, ts, cache_dir, stat)
        if not p.exists():
            uncached_ts.append(float(ts))
        elif on_frame_saved:
            on_frame_saved(ts)

    if not uncached_ts:
        return [str(get_video_frame_cache_path(filepath, ts, cache_dir, stat)) for ts in timestamps]

    sorted_ts = sorted(set(uncached_ts))
    processed_set = set()

    # Attempt 1: Single-pass hardware-accelerated / PyAV cascade
    try:
        container, stream, _ = open_video_cascade(filepath)
        try:
            time_base = float(stream.time_base) if stream.time_base else 0.001
            first_ts = sorted_ts[0]
            first_pts = int(round(max(0.0, first_ts) / time_base))
            try:
                container.seek(first_pts, stream=stream, backward=True)
            except Exception:
                container.seek(0)

            ts_idx = 0
            num_ts = len(sorted_ts)
            last_frame = None

            for frame in container.decode(stream):
                frame_ts = float(frame.pts * stream.time_base) if (frame.pts is not None and stream.time_base) else 0.0
                last_frame = frame

                while ts_idx < num_ts and frame_ts >= sorted_ts[ts_idx] - 0.05:
                    target_ts = sorted_ts[ts_idx]
                    out_path = get_video_frame_cache_path(filepath, target_ts, cache_dir, stat)
                    if not out_path.exists():
                        bgr_arr = frame.to_ndarray(format="bgr24")
                        rgb_arr = cv2.cvtColor(bgr_arr, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(rgb_arr)
                        pil_img.thumbnail((480, 480))
                        pil_img.convert("RGB").save(out_path, format="JPEG", quality=78, optimize=True)
                        pil_img.close()
                    if on_frame_saved:
                        on_frame_saved(target_ts)
                    processed_set.add(target_ts)
                    ts_idx += 1

                if ts_idx >= num_ts:
                    break

            # If stream ended before reaching the latest timestamps, use the last decoded frame
            while ts_idx < num_ts and last_frame is not None:
                target_ts = sorted_ts[ts_idx]
                out_path = get_video_frame_cache_path(filepath, target_ts, cache_dir, stat)
                if not out_path.exists():
                    bgr_arr = last_frame.to_ndarray(format="bgr24")
                    rgb_arr = cv2.cvtColor(bgr_arr, cv2.COLOR_BGR2RGB)
                    pil_img = Image.fromarray(rgb_arr)
                    pil_img.thumbnail((480, 480))
                    pil_img.convert("RGB").save(out_path, format="JPEG", quality=78, optimize=True)
                    pil_img.close()
                if on_frame_saved:
                    on_frame_saved(target_ts)
                processed_set.add(target_ts)
                ts_idx += 1
        finally:
            container.close()
    except Exception as e:
        print(f"Batch PyAV extraction error for {filepath}: {e}")

    # Fallback with OpenCV for any timestamps not decoded
    remaining_ts = [ts for ts in sorted_ts if ts not in processed_set]
    if remaining_ts:
        capture = cv2.VideoCapture(filepath)
        try:
            for ts in remaining_ts:
                out_path = get_video_frame_cache_path(filepath, ts, cache_dir, stat)
                if not out_path.exists():
                    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, ts) * 1000.0)
                    success, frame = capture.read()
                    if success and frame is not None:
                        rgb_arr = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(rgb_arr)
                        pil_img.thumbnail((480, 480))
                        pil_img.convert("RGB").save(out_path, format="JPEG", quality=78, optimize=True)
                        pil_img.close()
                if on_frame_saved:
                    on_frame_saved(ts)
        finally:
            capture.release()

    return [str(get_video_frame_cache_path(filepath, ts, cache_dir, stat)) for ts in timestamps]

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


def _iter_video_analysis_frames(filepath, analysis_interval_seconds, should_cancel=None):
    """Yield low-frequency source frames (timestamp, bgr_array) using 3-stage cascading decoder."""
    try:
        container, stream, _ = open_video_cascade(filepath)
    except Exception:
        container = None

    if container is not None:
        try:
            fps = float(stream.average_rate or stream.base_rate or 30.0)
            time_base = float(stream.time_base) if stream.time_base else (1.0 / fps)
            last_analysis_ts = -1.0

            for frame in container.decode(stream):
                if should_cancel and should_cancel():
                    break
                ts = float(frame.pts * time_base) if frame.pts is not None else 0.0
                if last_analysis_ts < 0 or (ts - last_analysis_ts >= analysis_interval_seconds * 0.95):
                    bgr_arr = frame.to_ndarray(format="bgr24")
                    yield ts, bgr_arr
                    last_analysis_ts = ts
            return
        finally:
            container.close()

    # OpenCV Fallback if PyAV could not be opened
    capture = cv2.VideoCapture(filepath)
    try:
        if not capture.isOpened():
            raise ValueError("Video could not be opened.")
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
        step_frames = max(1, round(fps * analysis_interval_seconds))
        frame_index = 0
        while True:
            if should_cancel and should_cancel():
                break
            if frame_index % step_frames == 0:
                success, frame = capture.read()
                if not success or frame is None:
                    break
                pos_msec = capture.get(cv2.CAP_PROP_POS_MSEC)
                ts = (pos_msec / 1000.0) if pos_msec > 0 else (frame_index / fps)
                yield ts, frame
            else:
                if not capture.grab():
                    break
            frame_index += 1
    finally:
        capture.release()


def iter_video_frames(
    filepath,
    analysis_interval_seconds=VIDEO_ANALYSIS_INTERVAL_SECONDS,
    should_cancel=None
):
    """Yield scene-aware, de-duplicated PIL frames without modifying the video."""
    previous_descriptor = None
    last_selected_descriptor = None
    last_selected_timestamp = None
    scene_id = 0

    for timestamp, frame in _iter_video_analysis_frames(
        filepath, analysis_interval_seconds, should_cancel=should_cancel
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

class Indexer:
    def __init__(self, model_manager: ModelManager, db_path=None):
        if db_path is None:
            # Always put the db relative to this python file inside the api folder
            db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_data")
            
        self.model_manager = model_manager
        self.client = chromadb.PersistentClient(path=db_path)
        self.collection = None
        self.selected_folders_by_collection = {}
        self.cache_dir = pathlib.Path(__file__).parent.resolve() / "cache"
        self.cache_dir.mkdir(exist_ok=True)
        self._load_selected_folders()
        
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

    def _load_selected_folders(self):
        config_path = self.cache_dir / "indexed_folders.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.selected_folders_by_collection = {
                            k: set(v) for k, v in data.items() if isinstance(v, list)
                        }
            except Exception as e:
                print(f"[Warning] Failed to load indexed_folders.json: {e}")

    def _save_selected_folders(self):
        config_path = self.cache_dir / "indexed_folders.json"
        try:
            data = {
                k: sorted(list(v)) for k, v in self.selected_folders_by_collection.items()
            }
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Warning] Failed to save indexed_folders.json: {e}")

    def _get_selected_folders(self):
        if not self.collection:
            return set()
        return self.selected_folders_by_collection.setdefault(self.collection.name, set())

    def _add_selected_folder(self, folder_path: str):
        if not self.collection:
            return
        norm_new = os.path.abspath(os.path.normpath(folder_path))
        norm_new_lower = norm_new.lower()
        existing = self._get_selected_folders()

        for ex in list(existing):
            ex_lower = os.path.abspath(os.path.normpath(ex)).lower()
            if norm_new_lower == ex_lower or norm_new_lower.startswith(ex_lower + os.sep):
                return
            if ex_lower.startswith(norm_new_lower + os.sep):
                existing.discard(ex)

        existing.add(norm_new)
        self._save_selected_folders()

    def _remove_selected_folder(self, folder_path: str):
        if not self.collection:
            return
        norm_target = os.path.abspath(os.path.normpath(folder_path)).lower()
        existing = self._get_selected_folders()
        to_remove = {
            ex for ex in existing
            if os.path.abspath(os.path.normpath(ex)).lower() == norm_target
            or os.path.abspath(os.path.normpath(ex)).lower().startswith(norm_target + os.sep)
        }
        for r in to_remove:
            existing.discard(r)
        self._save_selected_folders()

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
            self.selected_folders_by_collection.pop(collection_name, None)
            self._save_selected_folders()
            self.switch_collection(collection_name)
            self.run_maintenance()

    def delete_collection(self, collection_name: str):
        """Permanently delete a collection and its data."""
        print(f"Deleting Chroma collection: {collection_name}")
        try:
            self.client.delete_collection(name=collection_name)
            if self.collection and self.collection.name == collection_name:
                self.collection = None
            self.selected_folders_by_collection.pop(collection_name, None)
            self._save_selected_folders()
            self.run_maintenance()
        except Exception as e:
            print(f"Error deleting collection {collection_name}: {e}")

    def get_indexed_folders(self):
        """Get a list of unique parent directories and their subfolders currently indexed with existence status and item counts."""
        if not self._ensure_collection():
            return []
        
        try:
            results = self.collection.get(include=["metadatas"])
            if not results or not results.get("metadatas"):
                return []

            seen_db_keys = set()
            db_items = []
            for meta in results["metadatas"]:
                if meta and "path" in meta:
                    p = os.path.abspath(os.path.normpath(meta["path"]))
                    m_type = meta.get("media_type", "image")
                    key = (p.lower(), m_type)
                    if key not in seen_db_keys:
                        seen_db_keys.add(key)
                        db_items.append({"path": p, "media_type": m_type})

            if not db_items:
                return []

            db_paths = [item["path"] for item in db_items]

            # 1. Start with persisted selected folders for this collection
            selected_folders = self._get_selected_folders()
            active_folders = set()

            for sf in list(selected_folders):
                sf_norm = os.path.abspath(os.path.normpath(sf))
                sf_lower = sf_norm.lower()
                has_items = any(p.lower() == sf_lower or p.lower().startswith(sf_lower + os.sep) for p in db_paths)
                if has_items:
                    active_folders.add(sf_norm)
                else:
                    selected_folders.discard(sf)

            # 2. For any db_paths not covered by active selected folders, find their topmost common roots
            covered_paths = set()
            for sf in active_folders:
                sf_lower = sf.lower()
                for p in db_paths:
                    if p.lower() == sf_lower or p.lower().startswith(sf_lower + os.sep):
                        covered_paths.add(p)

            uncovered_paths = [p for p in db_paths if p not in covered_paths]
            if uncovered_paths:
                uncovered_parents = set(os.path.dirname(p) for p in uncovered_paths)
                sorted_parents = sorted(uncovered_parents, key=lambda x: len(x))
                topmost_parents = set()
                for parent in sorted_parents:
                    parent_lower = parent.lower()
                    if not any(parent_lower.startswith(top.lower() + os.sep) for top in topmost_parents):
                        topmost_parents.add(parent)

                for parent in topmost_parents:
                    active_folders.add(parent)
                    selected_folders.add(parent)

            # 3. Collapse any nested subfolders (parent folder takes precedence as root)
            final_root_folders = set()
            sorted_active = sorted(active_folders, key=lambda x: len(x))
            for f in sorted_active:
                f_lower = f.lower()
                if not any(f_lower.startswith(top.lower() + os.sep) for top in final_root_folders):
                    final_root_folders.add(f)

            self._save_selected_folders()

            # 4. Build hierarchical tree with subfolders and file counts for each root folder
            output = []
            for root_path in sorted(final_root_folders, key=lambda x: x.lower()):
                root_lower = root_path.lower()
                root_items = [
                    it for it in db_items
                    if it["path"].lower() == root_lower or it["path"].lower().startswith(root_lower + os.sep)
                ]

                # Scan disk file counts for this root folder tree
                disk_counts_by_dir = {}
                if os.path.isdir(root_path):
                    try:
                        for r, _, f_list in os.walk(root_path):
                            r_norm = os.path.abspath(os.path.normpath(r))
                            r_lower_dir = r_norm.lower()
                            imgs = 0
                            vids = 0
                            for fname in f_list:
                                ext = os.path.splitext(fname)[1].lower()
                                if ext in IMAGE_EXTENSIONS:
                                    imgs += 1
                                elif ext in VIDEO_EXTENSIONS:
                                    vids += 1
                            if imgs > 0 or vids > 0:
                                disk_counts_by_dir[r_lower_dir] = {"images": imgs, "videos": vids}
                    except Exception:
                        pass

                subfolder_data = {}
                direct_images = 0
                direct_videos = 0

                for it in root_items:
                    file_dir = os.path.dirname(it["path"])
                    is_img = it["media_type"] != "video"

                    if file_dir.lower() == root_lower:
                        if is_img:
                            direct_images += 1
                        else:
                            direct_videos += 1
                    else:
                        if file_dir not in subfolder_data:
                            subfolder_data[file_dir] = {"images": 0, "videos": 0}
                        if is_img:
                            subfolder_data[file_dir]["images"] += 1
                        else:
                            subfolder_data[file_dir]["videos"] += 1

                subfolders_list = []
                for sub_dir, counts in subfolder_data.items():
                    rel = os.path.relpath(sub_dir, root_path)
                    depth = len(rel.split(os.sep))
                    sub_norm = os.path.abspath(os.path.normpath(sub_dir))
                    sub_lower = sub_norm.lower()

                    direct_disk_imgs = disk_counts_by_dir.get(sub_lower, {}).get("images", counts["images"])
                    direct_disk_vids = disk_counts_by_dir.get(sub_lower, {}).get("videos", counts["videos"])
                    sub_disk_imgs = sum(
                        c["images"] for d, c in disk_counts_by_dir.items()
                        if d == sub_lower or d.startswith(sub_lower + os.sep)
                    )
                    sub_disk_vids = sum(
                        c["videos"] for d, c in disk_counts_by_dir.items()
                        if d == sub_lower or d.startswith(sub_lower + os.sep)
                    )

                    subfolders_list.append({
                        "path": sub_dir,
                        "name": os.path.basename(sub_dir) or sub_dir,
                        "relative_path": rel,
                        "depth": depth,
                        "exists": os.path.isdir(sub_dir),
                        "image_count": counts["images"],
                        "video_count": counts["videos"],
                        "item_count": counts["images"] + counts["videos"],
                        "disk_image_count": max(counts["images"], sub_disk_imgs),
                        "disk_video_count": max(counts["videos"], sub_disk_vids),
                        "direct_disk_image_count": max(counts["images"], direct_disk_imgs),
                        "direct_disk_video_count": max(counts["videos"], direct_disk_vids)
                    })

                subfolders_list.sort(key=lambda s: s["relative_path"].lower())

                total_images = direct_images + sum(s["image_count"] for s in subfolders_list)
                total_videos = direct_videos + sum(s["video_count"] for s in subfolders_list)
                root_disk_imgs = sum(c["images"] for c in disk_counts_by_dir.values())
                root_disk_vids = sum(c["videos"] for c in disk_counts_by_dir.values())

                output.append({
                    "path": root_path,
                    "name": os.path.basename(root_path) or root_path,
                    "exists": os.path.isdir(root_path),
                    "direct_image_count": direct_images,
                    "direct_video_count": direct_videos,
                    "image_count": total_images,
                    "video_count": total_videos,
                    "item_count": total_images + total_videos,
                    "total_disk_image_count": max(total_images, root_disk_imgs),
                    "total_disk_video_count": max(total_videos, root_disk_vids),
                    "subfolder_count": len(subfolders_list),
                    "subfolders": subfolders_list
                })

            return output
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

    def get_folder_contents(self, folder_path: str, limit: int = 50000):
        """List supported media in a folder with indexing status and ghost record detection."""
        if not os.path.isdir(folder_path):
            raise ValueError("Folder does not exist or is not accessible.")

        normalized_folder = os.path.abspath(os.path.normpath(folder_path))
        norm_folder_lower = normalized_folder.lower()

        # 1. Fetch all indexed paths for this folder from ChromaDB
        indexed_map = {} # path_lower -> {"path": meta_path, "media_type": meta_type}
        if self._ensure_collection():
            try:
                res = self.collection.get(include=["metadatas"])
                if res and res.get("metadatas"):
                    for meta in res["metadatas"]:
                        if meta and "path" in meta:
                            raw_p = meta["path"]
                            p_norm = os.path.abspath(os.path.normpath(raw_p))
                            p_lower = p_norm.lower()
                            if p_lower == norm_folder_lower or p_lower.startswith(norm_folder_lower + os.sep):
                                if p_lower not in indexed_map:
                                    indexed_map[p_lower] = {
                                        "path": p_norm,
                                        "media_type": meta.get("media_type", "image")
                                    }
            except Exception as e:
                print(f"[Warning] Error querying ChromaDB metadata in get_folder_contents: {e}")

        items = []
        image_count = 0
        video_count = 0
        seen_disk_paths = set()

        # 2. Scan physical files on disk
        for root, _, files in os.walk(normalized_folder):
            for file in files:
                extension = os.path.splitext(file)[1].lower()
                if extension not in IMAGE_EXTENSIONS and extension not in VIDEO_EXTENSIONS:
                    continue

                file_path = os.path.join(root, file)
                p_norm = os.path.abspath(os.path.normpath(file_path))
                p_lower = p_norm.lower()
                seen_disk_paths.add(p_lower)

                media_type = "image" if extension in IMAGE_EXTENSIONS else "video"

                try:
                    stat = os.stat(file_path)
                except OSError:
                    continue

                if media_type == "image":
                    image_count += 1
                else:
                    video_count += 1

                is_indexed = p_lower in indexed_map

                items.append({
                    "name": file,
                    "path": file_path,
                    "relative_path": os.path.relpath(file_path, normalized_folder),
                    "media_type": media_type,
                    "extension": extension,
                    "size": stat.st_size,
                    "modified_at": stat.st_mtime,
                    "is_indexed": is_indexed,
                    "exists_on_disk": True
                })

        # 3. Detect ghost records (in vector DB, but no longer on disk)
        missing_on_disk_items = []
        for p_lower, info in indexed_map.items():
            if p_lower not in seen_disk_paths:
                ghost_path = info["path"]
                ghost_name = os.path.basename(ghost_path) or ghost_path
                ghost_ext = os.path.splitext(ghost_path)[1].lower()
                ghost_media = info.get("media_type", "image")
                missing_on_disk_items.append({
                    "name": ghost_name,
                    "path": ghost_path,
                    "relative_path": os.path.relpath(ghost_path, normalized_folder),
                    "media_type": ghost_media,
                    "extension": ghost_ext,
                    "size": 0,
                    "modified_at": 0,
                    "is_indexed": True,
                    "exists_on_disk": False
                })

        all_items = items + missing_on_disk_items
        all_items.sort(key=lambda item: item["relative_path"].lower())

        indexed_count = sum(1 for it in all_items if it.get("is_indexed"))
        unindexed_count = sum(1 for it in all_items if not it.get("is_indexed") and it.get("exists_on_disk"))
        missing_on_disk_count = len(missing_on_disk_items)
        truncated = len(all_items) > limit

        return {
            "folder_path": normalized_folder,
            "items": all_items[:limit],
            "image_count": image_count,
            "video_count": video_count,
            "total_count": len(all_items),
            "indexed_count": indexed_count,
            "unindexed_count": unindexed_count,
            "missing_on_disk_count": missing_on_disk_count,
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
                save_video_frame_thumbnail(normalized_path, timestamp, image, self.cache_dir, stat)

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

                    extract_video_frames_batch(filepath, timestamps, self.cache_dir, on_frame_saved=on_frame_done)

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

    def index_directory(self, directory: str, task_context=None):
        self.batch_index_folders([directory], task_context=task_context)

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
            existing_ids = set(existing_results["ids"]) if existing_results and "ids" in existing_results else set()
            existing_video_entries = self._get_existing_video_entries(existing_results)
            
            # Filter out already indexed files
            pending_files = [f for f in files_to_index if f not in existing_ids]
            self.indexed_files = len(files_to_index) - len(pending_files)
            if task_context:
                task_context.update_progress(self.indexed_files, self.total_files, "Indexing items...")

            batch_size = self.model_manager.get_effective_batch_size()
            max_workers = min(16, max(2, (os.cpu_count() or 4)))

            for i in range(0, len(pending_files), batch_size):
                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                    print("[Notice] Indexing cancelled by user.")
                    break

                chunk_files = pending_files[i:i + batch_size]
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
                        if task_context:
                            task_context.add_error(f"{os.path.basename(filepath)}: {err}")
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
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
                            existing_ids.add(filepath)
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
                            for fid in valid_ids:
                                existing_ids.add(fid)
                            self.indexed_files += len(valid_ids)
                            if task_context:
                                task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(valid_ids[-1]))
                    except Exception as e:
                        print(f"Batch embedding failed, falling back to item-by-item: {e}")
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
                                    existing_ids.add(fid)
                            except Exception as ex:
                                print(f"Error indexing item fallback {fid}: {ex}")
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
            db_paths = {e["path"] for e in db_image_entries}
            db_hashes_by_path = {e["path"]: e["hash"] for e in db_image_entries}
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
            batch_size = self.model_manager.get_effective_batch_size()
            max_workers = min(16, max(2, (os.cpu_count() or 4)))

            for i in range(0, len(disk_files), batch_size):
                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                    print("[Notice] Re-indexing cancelled by user.")
                    break

                chunk_files = disk_files[i:i + batch_size]
                if not chunk_files:
                    continue
                self.current_file = chunk_files[0]
                if task_context:
                    task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(self.current_file))

                # Parallel CPU preprocessing
                worker_results = []
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_file = {executor.submit(process_file_worker, f): f for f in chunk_files}
                    for future in as_completed(future_to_file):
                        if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                            break
                        worker_results.append(future.result())

                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
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
                        if task_context:
                            task_context.add_error(f"{os.path.basename(filepath)}: {err}")
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
                        continue

                    # If already in DB with same hash, skip
                    if filepath in db_paths and db_hashes_by_path.get(filepath) == file_hash:
                        try:
                            image.close()
                        except Exception:
                            pass
                        self.indexed_files += 1
                        if task_context:
                            task_context.update_progress(self.indexed_files, self.total_files, os.path.basename(filepath))
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

                if self.cancel_requested or (task_context and not task_context.check_paused_or_cancelled()):
                    break

                for filepath, file_hash, image in items_needing_indexing:
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
                        print(f"Batch embedding failed during reindex fallback: {e}")
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
                                print(f"Error re-indexing item fallback {fid}: {ex}")
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

            if not self.cancel_requested and not (task_context and task_context.cancel_requested):
                self._index_video_files(disk_video_files, existing_video_entries, task_context=task_context)
                
        finally:
            self.is_indexing = False
            self.current_file = ""
            self.last_task_id += 1

    reindex_folder = reindex_directory

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
