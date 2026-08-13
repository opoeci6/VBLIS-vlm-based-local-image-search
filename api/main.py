from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, UploadFile, File
import torch

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn
import os
import io
import struct
import pathlib
from dotenv import load_dotenv
import shutil
import hashlib
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

# EXIF orientation tag ID
_EXIF_ORIENTATION_TAG = 0x0112

# Maps EXIF orientation value -> (PIL transpose methods to apply in order)
_ORIENTATION_TRANSFORMS = {
    2: [Image.FLIP_LEFT_RIGHT],
    3: [Image.ROTATE_180],
    4: [Image.FLIP_TOP_BOTTOM],
    5: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_90],
    6: [Image.ROTATE_270],
    7: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_270],
    8: [Image.ROTATE_90],
}

def _parse_exif_orientation(exif_bytes: bytes) -> int:
    """Parse the EXIF orientation tag directly from raw EXIF bytes (TIFF structure).
    Returns the orientation value (1-8), or 1 (no rotation) if not found."""
    try:
        # Strip optional 'Exif\x00\x00' header to get to the TIFF data
        tiff = exif_bytes[6:] if exif_bytes.startswith(b"Exif\x00\x00") else exif_bytes
        if len(tiff) < 8:
            return 1
        # Determine byte order
        byte_order = tiff[:2]
        if byte_order == b"II":
            endian = "<"   # little-endian
        elif byte_order == b"MM":
            endian = ">"   # big-endian
        else:
            return 1
        # Read offset to first IFD
        ifd_offset = struct.unpack(endian + "I", tiff[4:8])[0]
        if ifd_offset + 2 > len(tiff):
            return 1
        num_entries = struct.unpack(endian + "H", tiff[ifd_offset:ifd_offset + 2])[0]
        for i in range(num_entries):
            entry_offset = ifd_offset + 2 + i * 12
            if entry_offset + 12 > len(tiff):
                break
            tag = struct.unpack(endian + "H", tiff[entry_offset:entry_offset + 2])[0]
            if tag == _EXIF_ORIENTATION_TAG:
                value = struct.unpack(endian + "H", tiff[entry_offset + 8:entry_offset + 10])[0]
                return value
    except Exception:
        pass
    return 1

def _apply_exif_orientation(img: Image.Image, exif_bytes: bytes) -> Image.Image:
    """Rotate/flip a PIL image to correct orientation based on raw EXIF bytes."""
    orientation = _parse_exif_orientation(exif_bytes)
    transforms = _ORIENTATION_TRANSFORMS.get(orientation, [])
    for t in transforms:
        img = img.transpose(t)
    return img


# Ensure we load the .env relative to THIS script, and strictly enforce HF_HOME
api_dir = pathlib.Path(__file__).parent.resolve()
load_dotenv(api_dir / ".env", override=True)
os.environ["HF_HOME"] = str(api_dir / "models")
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "30"
os.environ["HF_HUB_ENABLE_EMERGENCY_RETRY"] = "False"

CACHE_DIR = api_dir / "cache"
CACHE_DIR.mkdir(exist_ok=True)

def compute_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

from model_manager import ModelManager
from indexer import Indexer

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize indexer and models gracefully
    print("Starting API backend...")
    try:
        model_manager.load_model("google/siglip2-base-patch16-224", local_files_only=True)
        indexer.switch_collection(model_manager.get_collection_name())
    except Exception as e:
        print(f"[Notice] Default model not found locally: {e}. Ready for manual download.")
    yield
    print("Shutting down API backend...")

app = FastAPI(title="Local Image Search API", lifespan=lifespan)

# Allow Electron frontend to access API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model_manager = ModelManager()
indexer = Indexer(model_manager)

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = 0.20

class IndexRequest(BaseModel):
    directory: str

class ModelSwitchRequest(BaseModel):
    model_name: str

class ModelDeleteRequest(BaseModel):
    model_name: str
    delete_index: bool = False

class FolderDeleteRequest(BaseModel):
    folder_path: str

class BatchFolderRequest(BaseModel):
    folder_paths: list[str]

class GPUSettingsRequest(BaseModel):
    use_gpu: bool

@app.get("/settings/gpu")
async def get_gpu_settings():
    print(f"GPU settings requested: {model_manager.use_gpu}, {torch.cuda.is_available()}")
    return {
        "use_gpu": model_manager.use_gpu,
        "cuda_available": torch.cuda.is_available(),
        "device": model_manager.device
    }

@app.post("/settings/gpu")
async def set_gpu_settings(req: GPUSettingsRequest):
    print(f"Set GPU settings requested: {req.use_gpu}")
    result = model_manager.set_device(req.use_gpu)
    
    # Persist setting to .env
    try:
        env_path = api_dir / ".env"
        lines = []
        if env_path.exists():
            with open(env_path, "r") as f:
                lines = f.readlines()
        
        updated = False
        new_lines = []
        for line in lines:
            if line.startswith("USE_GPU="):
                new_lines.append(f"USE_GPU={req.use_gpu}\n")
                updated = True
            else:
                new_lines.append(line)
        
        if not updated:
            new_lines.append(f"USE_GPU={req.use_gpu}\n")
            
        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"Failed to persist GPU setting: {e}")

    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

@app.post("/search")
def search_images(req: SearchQuery):
    if not req.query.strip():
        return {"results": []}
    
    try:
        results = indexer.search(req.query, req.top_k, req.min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search/image")
async def search_images_by_file(file: UploadFile = File(...), top_k: int = 50, min_score: float = 0.15):
    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        results = indexer.search_by_image(img, top_k, min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index")
async def start_indexing(req: IndexRequest, background_tasks: BackgroundTasks):
    if not os.path.isdir(req.directory):
        raise HTTPException(status_code=400, detail="Invalid directory path.")
    
    # Add folder indexing to background queue
    background_tasks.add_task(indexer.index_directory, req.directory)
    return {"status": "Indexing started in background", "target": req.directory}

@app.post("/index/folders/batch-index")
async def batch_index_folders(req: BatchFolderRequest, background_tasks: BackgroundTasks):
    # Filter out invalid directories
    valid_dirs = [d for d in req.folder_paths if os.path.isdir(d)]
    if not valid_dirs:
        raise HTTPException(status_code=400, detail="No valid directory paths provided.")
    
    background_tasks.add_task(indexer.batch_index_folders, valid_dirs)
    return {"status": "Batch indexing started in background", "targets": valid_dirs}

@app.post("/index/clear")
def clear_index():
    try:
        indexer.clear_collection()
        return {"status": "success", "message": "Index cache cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/maintenance")
def run_maintenance():
    try:
        result = indexer.run_maintenance()
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/index/folders")
def get_indexed_folders():
    try:
        folders = indexer.get_indexed_folders()
        return {"folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folder/delete")
def delete_folder_index(req: FolderDeleteRequest):
    try:
        count = indexer.delete_folder_index(req.folder_path)
        return {"status": "success", "message": f"Deleted {count} entries for folder: {req.folder_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folder/reindex")
async def reindex_folder(req: FolderDeleteRequest, background_tasks: BackgroundTasks):
    if not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="Invalid directory path.")
    
    background_tasks.add_task(indexer.reindex_directory, req.folder_path)
    return {"status": "Re-indexing started in background", "target": req.folder_path}

@app.post("/index/folders/batch-delete")
def batch_delete_folders(req: BatchFolderRequest):
    try:
        count = indexer.batch_delete_folders(req.folder_paths)
        return {"status": "success", "message": f"Deleted entries for {len(req.folder_paths)} folders. Total records removed: {count}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index/folders/batch-reindex")
async def batch_reindex_folders(req: BatchFolderRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(indexer.batch_reindex_folders, req.folder_paths)
    return {"status": "Batch re-indexing started in background"}

@app.get("/status")
async def get_status():
    return indexer.get_status()

@app.get("/models")
async def list_models():
    available = [
        "google/siglip2-base-patch16-224",
        "google/siglip2-base-patch16-naflex",
        "google/siglip2-so400m-patch14-384",
        "google/siglip2-so400m-patch16-naflex",
        "openai/clip-vit-base-patch32",
    ]
    results = []
    for m in available:
        status_info = model_manager.downloader.inspect_model_status(m)
        results.append({
            "id": m,
            "downloaded": status_info["downloaded"],
            "incomplete": status_info["incomplete"],
            "download_total_bytes": status_info["download_total_bytes"],
            "download_current_bytes": status_info["download_current_bytes"]
        })
    return {
        "active_model": model_manager.current_model_id,
        "models": results
    }

@app.post("/models/delete")
async def delete_model(req: ModelDeleteRequest):
    if model_manager.is_downloading:
        raise HTTPException(status_code=400, detail="Cannot delete model while a download is in progress.")
        
    model_id = req.model_name
    # If the model to delete is currently active, unload it first
    if model_manager.current_model_id == model_id:
        model_manager.unload_model()
    
    # Deriving collection name manually to delete index if requested
    if req.delete_index:
        collection_name = model_id.replace("/", "_").replace("-", "_")
        indexer.delete_collection(collection_name)

    hub_path = api_dir / "models" / "hub"
    folder_name = f"models--{model_id.replace('/', '--')}"
    model_path = hub_path / folder_name
    
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model folder not found locally.")
        
    try:
        shutil.rmtree(model_path)
        # Also try to remove locks if any
        locks_path = hub_path / ".locks" / folder_name
        if locks_path.exists():
            shutil.rmtree(locks_path)
            
        return {"status": "success", "message": f"Model {model_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {str(e)}")

@app.post("/models/download")
async def download_model(req: ModelSwitchRequest, background_tasks: BackgroundTasks):
    if model_manager.is_downloading:
        return {"status": "Error", "message": "A download is already in progress."}
    
    def download_and_switch(model_name):
        try:
            model_manager.load_model(model_name, local_files_only=False)
            indexer.switch_collection(model_manager.get_collection_name())
            print(f"Successfully downloaded and loaded {model_name}")
        except Exception as e:
            error_msg = str(e)
            if "cancelled by user" in error_msg.lower():
                error_msg = "Download cancelled by user"
            model_manager.download_error = error_msg
            print(f"Error downloading {model_name}: {error_msg}")

    background_tasks.add_task(download_and_switch, req.model_name)
    return {"status": "Downloading"}

@app.post("/models/download/cancel")
async def cancel_download():
    model_manager.cancel_download = True
    return {"status": "Cancellation requested"}

@app.post("/models/switch")
def switch_model(req: ModelSwitchRequest):
    try:
        model_manager.load_model(req.model_name, local_files_only=True)
        # Switching models connects to a different ChromaDB collection
        indexer.switch_collection(model_manager.get_collection_name())
        return {"status": "Model switched correctly", "active_model": req.model_name}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Model not found locally: {str(e)}")

@app.post("/models/unload")
def unload_model():
    try:
        model_manager.unload_model()
        return {"status": "success", "message": "Model unloaded and VRAM cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unload model: {str(e)}")


@app.post("/image/cache/clear")
def clear_image_cache():
    try:
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
        CACHE_DIR.mkdir(exist_ok=True)
        return {"status": "success", "message": "Thumbnail cache cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/image")
def serve_image(path: str = Query(...), size: str = "full"):
    """Serve a local image file by absolute path. Transcodes HEIC to JPEG.
    Supports size='thumbnail' for faster loading in the UI grid.
    Thumbnails are cached on disk in the 'cache' directory.
    """
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    
    ext = os.path.splitext(path)[1].lower()
    is_heic = ext in (".heic", ".heif")
    
    # If thumbnail is requested, check cache first
    if size == "thumbnail":
        file_hash = compute_hash(path)
        cache_path = CACHE_DIR / f"{file_hash}_thumb.jpg"
        
        if cache_path.exists():
            return FileResponse(cache_path)
            
        # Not in cache, need to generate
        try:
            if is_heic:
                heif_file = pillow_heif.open_heif(path)
                img = Image.frombytes(
                    heif_file.mode,
                    heif_file.size,
                    heif_file.data,
                    "raw",
                )
                exif_bytes = heif_file.info.get("exif", b"")
                if exif_bytes:
                    img = _apply_exif_orientation(img, exif_bytes)
            else:
                img = Image.open(path)
                img = ImageOps.exif_transpose(img)
            
            # Generate thumbnail
            img.thumbnail((480, 480))
            img.convert("RGB").save(cache_path, format="JPEG", quality=78, optimize=True)
            return FileResponse(cache_path)
        except Exception as e:
            # Fallback to full image if thumbnail generation fails, but log it
            print(f"Thumbnail generation failed: {e}")
            pass

    # Serve full image (with HEIC transcoding if necessary)
    if is_heic:
        try:
            heif_file = pillow_heif.open_heif(path)
            img = Image.frombytes(
                heif_file.mode,
                heif_file.size,
                heif_file.data,
                "raw",
            )
            exif_bytes = heif_file.info.get("exif", b"")
            if exif_bytes:
                img = _apply_exif_orientation(img, exif_bytes)
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=90)
            buf.seek(0)
            return StreamingResponse(buf, media_type="image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to transcode HEIC: {str(e)}")
    
    return FileResponse(path)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
