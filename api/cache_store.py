import pathlib
import paths
from thumbnail_cache import TEMP_FILE_GLOB

CACHE_DIR = paths.CACHE_DIR
IMAGE_CACHE_DIR = paths.IMAGE_CACHE_DIR
VIDEO_CACHE_DIR = paths.VIDEO_CACHE_DIR

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

        for item in [*dir_path.glob("*.jpg"), *dir_path.glob(TEMP_FILE_GLOB)]:
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
