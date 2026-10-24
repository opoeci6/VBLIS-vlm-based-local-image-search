import io
import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from PIL import Image
from pydantic import BaseModel
import app_state
import security

router = APIRouter()

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = 0.20

@router.post("/search")
def search_images(req: SearchQuery):
    if not req.query.strip():
        return {"results": []}
    
    try:
        results = app_state.indexer.search(req.query, req.top_k, req.min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/image")
async def search_images_by_file(file: UploadFile = File(...), top_k: int = 50, min_score: float = 0.15):
    if file.size is not None and file.size > security.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload too large (max 50 MB)")
    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        results = app_state.indexer.search_by_image(img, top_k, min_score)
        # Filter out files that no longer exist on disk
        results = [r for r in results if os.path.isfile(r["path"])]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
