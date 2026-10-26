import io
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field, model_validator
import app_state
import security
from media_image import open_image_upright
from search_scoring import DEFAULT_TEXT_MIN_SCORE, DEFAULT_IMAGE_MIN_SIMILARITY
from search_session import SearchSessionExpired

router = APIRouter()

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = Field(DEFAULT_TEXT_MIN_SCORE, ge=0.0, le=1.0)

class SearchRefQuery(BaseModel):
    query_ref: str
    top_k: int = 50
    # No default: whether it is a match probability or a cosine similarity depends on the query behind the ref
    min_score: float = Field(..., ge=0.0, le=1.0)

class SearchVideoQuery(BaseModel):
    query_ref: Optional[str] = None
    query: Optional[str] = None  # used when the ref is unknown (e.g. expired)
    path: str
    min_score: Optional[float] = Field(None, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _needs_a_query(self):
        if not self.query_ref and not (self.query and self.query.strip()):
            raise ValueError("query_ref or query is required")
        return self

@router.post("/search")
def search_images(req: SearchQuery):
    if not req.query.strip():
        return {"results": [], "query_ref": None}

    try:
        # The indexer already skips files that no longer exist on disk
        return app_state.indexer.run_text_search(req.query, req.top_k, req.min_score)
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
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
        return app_state.indexer.run_image_search(img, top_k, min_score)
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/ref")
def search_again_by_ref(req: SearchRefQuery):
    try:
        return app_state.indexer.rerun_search(req.query_ref, req.top_k, req.min_score)
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/video")
def search_video_frames(req: SearchVideoQuery):
    try:
        return app_state.indexer.expand_video(req.path, req.min_score, req.query_ref, req.query)
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
