"""Original files for the browser: opened in a tab (pictures, playable videos) or downloaded.
Only the network app includes this router; the desktop app shows files in Explorer instead."""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from auth_context import Auth, current_auth
from media_image import IMAGE_EXTENSIONS
from media_video import VIDEO_EXTENSIONS
from routers.guards import require_indexed_path

router = APIRouter()

# Set here, not guessed: Windows' registry can map extensions to odd types
ORIGINAL_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
}


@router.get("/media/original")
def get_original(
    path: str = Query(..., max_length=4096),
    download: bool = False,
    auth: Auth = Depends(current_auth),
):
    require_indexed_path(path, IMAGE_EXTENSIONS | VIDEO_EXTENSIONS, auth=auth)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    extension = os.path.splitext(path)[1].lower()
    return FileResponse(
        path,
        media_type=ORIGINAL_TYPES.get(extension, "application/octet-stream"),
        filename=os.path.basename(path),
        content_disposition_type="attachment" if download else "inline",
    )
