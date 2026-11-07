import os
from fastapi import HTTPException
import app_state

def require_indexed_path(path: str, extensions=None):
    """403 unless path is inside an indexed folder (and has an allowed extension, when given).
    Runs before any existence check so the API can't be used to probe files elsewhere."""
    if not app_state.indexer.is_path_in_indexed_folders(path):
        raise HTTPException(status_code=403, detail="Path is not inside an indexed folder")
    if extensions is not None and os.path.splitext(path)[1].lower() not in extensions:
        raise HTTPException(status_code=403, detail="Unsupported file type")
