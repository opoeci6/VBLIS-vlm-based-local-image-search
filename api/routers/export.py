"""The desktop app's "Export index": list the models that have an index and queue the export of one of them
into a single file (index_export.py) that another machine can import.

Only main.app includes this router, and local_owner answers 404 to anything but the desktop app: the
file is written on this PC, to a path the desktop app chose."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import app_state
import index_export
from account_admin import error
from auth_context import local_owner
from model_manager import AVAILABLE_MODELS
from task_queue import TaskType

router = APIRouter(dependencies=[Depends(local_owner)])

_PATH_MAX = 4096


class ExportRequest(BaseModel):
    output_path: str = Field(..., max_length=_PATH_MAX)
    model_id: Optional[str] = Field(None, max_length=200)
    thumbnails: bool = True


def _record_count(client, model_id: str) -> int:
    """Records of a model's collection; 0 when it doesn't exist. Never creates the collection."""
    try:
        return client.get_collection(name=index_export.collection_name_for(model_id)).count()
    except Exception:  # noqa: BLE001  (Chroma raises different errors by version)
        return 0


@router.get("/index/export/collections")
def export_collections():
    client = app_state.indexer.client
    existing = {getattr(c, "name", c) for c in client.list_collections()}
    collections = []
    for model_id in AVAILABLE_MODELS:
        if index_export.collection_name_for(model_id) in existing:
            records = _record_count(client, model_id)
            if records > 0:
                collections.append({"model_id": model_id, "records": records})
    return {"active_model": app_state.model_manager.current_model_id, "collections": collections}


@router.post("/index/export")
def start_export(req: ExportRequest):
    try:
        output_path = index_export.resolve_output_path(req.output_path)
    except index_export.ExportError as e:
        return error(400, e.code, detail=str(e))
    model_id = req.model_id or app_state.model_manager.current_model_id
    if not model_id or model_id not in AVAILABLE_MODELS:
        return error(400, "unknown_model", detail="Choose one of the models VBLIS offers.")
    if _record_count(app_state.indexer.client, model_id) == 0:
        return error(400, "no_index", detail=f"There is no index for {model_id} yet.")
    task = app_state.task_queue.enqueue(
        TaskType.EXPORT_INDEX,
        {"output_path": output_path, "model_id": model_id, "thumbnails": req.thumbnails},
        title="Export index",
    )
    return {"status": "queued", "task": task.to_dict(), "output_path": output_path}
