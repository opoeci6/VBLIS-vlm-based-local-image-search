import io
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field
import app_state
import security
from media_image import open_image_upright
from search_scoring import DEFAULT_TEXT_MIN_SCORE, DEFAULT_IMAGE_MIN_SIMILARITY

router = APIRouter()

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = Field(DEFAULT_TEXT_MIN_SCORE, ge=0.0, le=1.0)

@router.post("/search")
def search_images(req: SearchQuery):
    if not req.query.strip():
        return {"results": []}
    
    try:
        # The indexer already skips files that no longer exist on disk
        return {"results": app_state.indexer.search(req.query, req.top_k, req.min_score)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/image")
def search_images_by_file(file: UploadFile = File(...), top_k: int = 50,
                           min_score: float = Query(DEFAULT_IMAGE_MIN_SIMILARITY, ge=0.0, le=1.0)):
    if file.size is not None and file.size > security.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload too large (max 50 MB)")
    try:
        contents = file.file.read()
        img = open_image_upright(io.BytesIO(contents))[0]
        return {"results": app_state.indexer.search_by_image(img, top_k, min_score)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
