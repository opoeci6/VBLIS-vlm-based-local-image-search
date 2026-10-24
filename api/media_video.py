import os
import hashlib
import pathlib
from PIL import Image
import cv2
import av
from av.codec.hwaccel import hwdevices_available, HWAccel
import paths
from functools import partial
from thumbnail_cache import (
    get_or_create_thumbnail, is_thumbnail_cached, save_jpeg_thumbnail
)

try:
    av.logging.set_level(av.logging.ERROR)
except Exception:
    pass

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
VIDEO_SAMPLING_VERSION = "adaptive-v3"
VIDEO_ANALYSIS_INTERVAL_SECONDS = 0.5
VIDEO_MAX_SAMPLE_GAP_SECONDS = 5.0
VIDEO_MIN_SAMPLE_GAP_SECONDS = 0.5
VIDEO_SCENE_PIXEL_THRESHOLD = 0.16
VIDEO_SCENE_HISTOGRAM_THRESHOLD = 0.42
VIDEO_DUPLICATE_PIXEL_THRESHOLD = 0.035
VIDEO_DUPLICATE_HISTOGRAM_THRESHOLD = 0.12

CACHE_DIR = paths.CACHE_DIR
VIDEO_CACHE_DIR = paths.VIDEO_CACHE_DIR

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
        if not is_thumbnail_cached(out_path):
            thumb = image.copy()
            get_or_create_thumbnail(out_path, partial(save_jpeg_thumbnail, thumb))
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
        if not is_thumbnail_cached(p):
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
                    if not is_thumbnail_cached(out_path):
                        bgr_arr = frame.to_ndarray(format="bgr24")
                        rgb_arr = cv2.cvtColor(bgr_arr, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(rgb_arr)
                        get_or_create_thumbnail(out_path, partial(save_jpeg_thumbnail, pil_img))
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
                if not is_thumbnail_cached(out_path):
                    bgr_arr = last_frame.to_ndarray(format="bgr24")
                    rgb_arr = cv2.cvtColor(bgr_arr, cv2.COLOR_BGR2RGB)
                    pil_img = Image.fromarray(rgb_arr)
                    get_or_create_thumbnail(out_path, partial(save_jpeg_thumbnail, pil_img))
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
                if not is_thumbnail_cached(out_path):
                    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, ts) * 1000.0)
                    success, frame = capture.read()
                    if success and frame is not None:
                        rgb_arr = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(rgb_arr)
                        get_or_create_thumbnail(out_path, partial(save_jpeg_thumbnail, pil_img))
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
