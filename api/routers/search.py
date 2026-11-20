import io
import math
from typing import Literal, Optional
import numpy as np
from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, model_validator
import app_state
import security
from auth_context import Auth, current_auth
from media_image import open_image_upright
from routers.guards import check_place_filters, hide_place_options, hide_places
from search_filters import SearchFilters
from search_scoring import DEFAULT_TEXT_MIN_SCORE, DEFAULT_IMAGE_MIN_SIMILARITY
from search_session import SearchSessionExpired

router = APIRouter()

def _json_native(value):
    """`value` with numpy scalars turned into Python numbers and NaN / infinity into None: the search routes
    answer with a JSONResponse (no jsonable_encoder pass over thousands of results), which refuses both."""
    if isinstance(value, dict):
        return {k: _json_native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_native(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value

def _json_response(payload):
    return JSONResponse(content=_json_native(payload))

class SearchQuery(BaseModel):
    query: str
    top_k: int = 50
    min_score: float = Field(DEFAULT_TEXT_MIN_SCORE, ge=0.0, le=1.0)
    filters: Optional[SearchFilters] = None

class SearchRefQuery(BaseModel):
    query_ref: str
    top_k: int = 50
    # No default: whether it is a match probability or a cosine similarity depends on the query behind the ref
    min_score: float = Field(..., ge=0.0, le=1.0)
    filters: Optional[SearchFilters] = None

class BrowseQuery(BaseModel):
    sort: Literal["newest", "oldest"] = "newest"
    top_k: Optional[int] = Field(None, ge=1)  # None: the whole library
    filters: Optional[SearchFilters] = None

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
def search_images(req: SearchQuery, auth: Auth = Depends(current_auth)):
    check_place_filters(auth, req.filters)
    if not req.query.strip():
        return _json_response({"results": [], "query_ref": None})

    try:
        # The indexer already skips files that no longer exist on disk
        found = app_state.indexer.run_text_search(req.query, req.top_k, req.min_score, filters=req.filters)
        return _json_response(hide_places(auth, found))
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/image")
def search_images_by_file(file: UploadFile = File(...), top_k: int = 50,
                           min_score: float = Query(DEFAULT_IMAGE_MIN_SIMILARITY, ge=0.0, le=1.0),
                           filters: Optional[str] = Form(None), auth: Auth = Depends(current_auth)):
    # A multipart form carries the filters as one JSON string; a bad one is a 422, like a bad JSON body
    parsed_filters = None
    if filters is not None and filters.strip():
        try:
            parsed_filters = SearchFilters.model_validate_json(filters)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False))
    check_place_filters(auth, parsed_filters)
    if file.size is not None and file.size > security.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload too large (max 50 MB)")
    try:
        contents = file.file.read()
        img = open_image_upright(io.BytesIO(contents))[0]
        found = app_state.indexer.run_image_search(img, top_k, min_score, filters=parsed_filters)
        return _json_response(hide_places(auth, found))
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/ref")
def search_again_by_ref(req: SearchRefQuery, auth: Auth = Depends(current_auth)):
    check_place_filters(auth, req.filters)
    try:
        found = app_state.indexer.rerun_search(req.query_ref, req.top_k, req.min_score, filters=req.filters)
        return _json_response(hide_places(auth, found))
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search/filter-options")
def search_filter_options(auth: Auth = Depends(current_auth)):
    try:
        return hide_place_options(auth, app_state.indexer.search_filter_options())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/video")
def search_video_frames(req: SearchVideoQuery, auth: Auth = Depends(current_auth)):
    try:
        return hide_places(auth, app_state.indexer.expand_video(req.path, req.min_score, req.query_ref, req.query),
                           key="frames")
    except SearchSessionExpired as e:
        raise HTTPException(status_code=410, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/browse")
def browse_library(req: BrowseQuery, auth: Auth = Depends(current_auth)):
    check_place_filters(auth, req.filters)
    try:
        found = app_state.indexer.browse_library(filters=req.filters, sort=req.sort, top_k=req.top_k)
        return _json_response(hide_places(auth, found))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
