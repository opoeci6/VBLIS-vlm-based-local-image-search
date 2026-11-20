import io
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import app_state
import paths
from auth_context import Auth, current_auth
from media_image import IMAGE_EXTENSIONS, compute_file_hash, decode_heif, open_image_upright
from media_video import (
    VIDEO_ANALYSIS_INTERVAL_SECONDS, VIDEO_EXTENSIONS, extract_video_frame, extract_video_frames_batch,
    get_video_frame_cache_path
)
from cache_store import IMAGE_CACHE_DIR, VIDEO_CACHE_DIR, get_cache_stats, safe_clear_cache
from task_queue import TaskType
from thumbnail_cache import get_or_create_thumbnail, save_jpeg_thumbnail
from routers.guards import require_indexed_path

router = APIRouter()

# A network client warms at most this many frames per request (a search result brings up to 50)
NETWORK_MAX_PREWARM_FRAMES = 100
# A viewer the owner hasn't allowed originals gets a re-encoded picture of at most this size,
# without the file's metadata (GPS included)
PREVIEW_MAX_SIDE = 2560


def _restricted(auth: Auth) -> bool:
    return auth.is_network and not auth.may("originals")


def _frame_time(auth: Auth, timestamp: float) -> float:
    """A network client's frame times are rounded to the indexing step (0.5 s), so it can't fill
    the frame cache with a new file for every millisecond of a video. Every time the app asks for
    (frame records, 1.0 s in the folder view) is already on that step."""
    if not auth.is_network:
        return timestamp
    return round(timestamp / VIDEO_ANALYSIS_INTERVAL_SECONDS) * VIDEO_ANALYSIS_INTERVAL_SECONDS


def _preview_response(path: str):
    img, _ = open_image_upright(path)
    try:
        return _jpeg_response(img, PREVIEW_MAX_SIDE)
    finally:
        img.close()


def _jpeg_response(img, max_side=None, quality=88):
    """img as a JPEG without any of the source's metadata (EXIF, XMP, comments), shrunk to fit max_side."""
    out = img.convert("RGB")
    out.info.clear()
    if max_side:
        out.thumbnail((max_side, max_side))
    buffer = io.BytesIO()
    out.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="image/jpeg")

class VideoBatchExtractRequest(BaseModel):
    path: str
    timestamps: list[float]

@router.get("/image/cache/stats")
def get_cache_statistics():
    return get_cache_stats()

@router.post("/image/cache/clear")
def clear_image_cache(target: str = Query("all", pattern="^(all|images|videos)$")):
    try:
        result = safe_clear_cache(target=target)
        return {"status": "success", "message": f"Successfully cleared {target} thumbnail cache.", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/video/frames/batch-extract")
def batch_extract_video_frames(req: VideoBatchExtractRequest, auth: Auth = Depends(current_auth)):
    require_indexed_path(req.path, VIDEO_EXTENSIONS, auth=auth)
    if not os.path.isfile(req.path):
        raise HTTPException(status_code=404, detail="Video file not found")
    if auth.is_network:
        timestamps = sorted({_frame_time(auth, t) for t in req.timestamps[:NETWORK_MAX_PREWARM_FRAMES]})
    else:
        timestamps = req.timestamps
    try:
        rotation = app_state.indexer.video_rotation(req.path)
        cached_paths = extract_video_frames_batch(req.path, timestamps, VIDEO_CACHE_DIR, rotation=rotation)
        return {"status": "success", "cached_count": len(cached_paths)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/video/thumbnails/regenerate")
def regenerate_video_thumbnails():
    t = app_state.task_queue.enqueue(
        TaskType.REBUILD_VIDEO_THUMBNAILS,
        {},
        title="Rebuild Video Thumbnails"
    )
    return {"status": "queued", "task_id": t.id, "message": "Video thumbnail regeneration added to queue."}

@router.get("/image")
def serve_image(
    path: str = Query(...),
    size: str = "full",
    timestamp: float = Query(0.0, ge=0.0),
    auth: Auth = Depends(current_auth),
):
    """Serve a local image file by absolute path. Transcodes HEIC to JPEG.
    Supports size='thumbnail' for faster loading in the UI grid.
    Thumbnails are cached on disk in segregated 'cache/images' and 'cache/videos' directories.
    """
    require_indexed_path(path, IMAGE_EXTENSIONS | VIDEO_EXTENSIONS, auth=auth)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(path)[1].lower()
    is_heic = ext in (".heic", ".heif")
    is_video = ext in VIDEO_EXTENSIONS

    if is_video:
        timestamp = _frame_time(auth, timestamp)
        try:
            stat = os.stat(path)
            rotation = app_state.indexer.video_rotation(path, stat)
            cache_path = get_video_frame_cache_path(path, timestamp, VIDEO_CACHE_DIR, stat, rotation)

            if size == "thumbnail":
                def render_frame_thumbnail(fp):
                    frame = extract_video_frame(path, timestamp)
                    save_jpeg_thumbnail(frame, fp)
                    frame.close()

                return FileResponse(get_or_create_thumbnail(cache_path, render_frame_thumbnail))

            frame = extract_video_frame(path, timestamp)
            if _restricted(auth):
                try:
                    return _jpeg_response(frame, PREVIEW_MAX_SIDE)
                finally:
                    frame.close()
            buffer = io.BytesIO()
            frame.convert("RGB").save(buffer, format="JPEG", quality=90)
            frame.close()
            buffer.seek(0)
            return StreamingResponse(buffer, media_type="image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to decode video frame: {str(e)}")

    # If thumbnail is requested, check cache first
    if size == "thumbnail":
        file_hash = compute_file_hash(path)
        cache_path = IMAGE_CACHE_DIR / f"{file_hash}_thumb.jpg"
        legacy_path = paths.CACHE_DIR / f"{file_hash}_thumb.jpg"

        def render_image_thumbnail(fp):
            save_jpeg_thumbnail(open_image_upright(path)[0], fp)

        try:
            return FileResponse(get_or_create_thumbnail(cache_path, render_image_thumbnail, legacy_path))
        except Exception as e:
            # Fallback to full image if thumbnail generation fails, but log it
            print(f"Thumbnail generation failed: {e}")
            pass

    if _restricted(auth):
        try:
            return _preview_response(path)
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to prepare the picture")

    # Serve full image (with HEIC transcoding if necessary)
    if is_heic:
        try:
            img = decode_heif(path)
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=90)
            buf.seek(0)
            return StreamingResponse(buf, media_type="image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to transcode HEIC: {str(e)}")

    return FileResponse(path)
