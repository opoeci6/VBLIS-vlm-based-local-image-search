# bootstrap first: it fixes up stdio, loads .env and sets HF_HOME, all before model_manager imports transformers
import bootstrap
import os
import paths
import security
from contextlib import asynccontextmanager
from fastapi import FastAPI
from model_manager import ModelManager
from indexer import Indexer
from task_queue import TaskQueueManager

model_manager = ModelManager()
indexer = Indexer(model_manager)
task_queue = TaskQueueManager(indexer, persistence_path=str(paths.DATA_DIR / "task_queue.json"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # uvicorn has configured logging by now; keep ?token= out of its access log
    security.install_access_log_redaction()
    # Initialize indexer and models gracefully
    print("Starting API backend...")
    active_model = os.getenv("ACTIVE_MODEL", "google/siglip2-base-patch16-224")
    try:
        print(f"Loading last active model: {active_model}")
        model_manager.load_model(active_model, local_files_only=True)
        indexer.switch_collection(model_manager.get_collection_name())
    except Exception as e:
        print(f"[Notice] Active model '{active_model}' not loaded: {e}. Ready for manual download.")
    task_queue.load_from_disk(current_active_model=model_manager.active_model)
    task_queue.start()
    yield
    print("Shutting down API backend...")
    task_queue.stop()
