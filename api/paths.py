"""Central definition of every on-disk location used by the backend.

By default all data lives next to this file (the api folder). Set the
VBLIS_DATA_DIR environment variable to relocate it (packaged builds, tests).
"""
import os
from pathlib import Path

API_DIR = Path(__file__).parent.resolve()

_data_dir_env = os.environ.get("VBLIS_DATA_DIR")
DATA_ROOT = Path(_data_dir_env).resolve() if _data_dir_env else API_DIR

MODELS_DIR = DATA_ROOT / "models"  # used as HF_HOME
HUB_DIR = MODELS_DIR / "hub"
CACHE_DIR = DATA_ROOT / "cache"
IMAGE_CACHE_DIR = CACHE_DIR / "images"
VIDEO_CACHE_DIR = CACHE_DIR / "videos"
DATA_DIR = DATA_ROOT / "data"
CHROMA_DIR = DATA_ROOT / "chroma_data"
ENV_FILE = DATA_ROOT / ".env"


def ensure_dirs():
    """Create the data folders that must exist before the backend starts."""
    for directory in (DATA_ROOT, CACHE_DIR, IMAGE_CACHE_DIR, VIDEO_CACHE_DIR, DATA_DIR):
        directory.mkdir(parents=True, exist_ok=True)
