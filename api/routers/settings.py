from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import torch
import app_state
import settings_store

router = APIRouter()

class GPUSettingsRequest(BaseModel):
    use_gpu: bool
    batch_size: int = 0
    precision_mode: Literal["auto", "fp16", "fp32"] = "auto"

@router.get("/settings/gpu")
async def get_gpu_settings():
    print(f"GPU settings requested: {app_state.model_manager.use_gpu}, {torch.cuda.is_available()}")
    return {
        "use_gpu": app_state.model_manager.use_gpu,
        "cuda_available": torch.cuda.is_available(),
        "device": app_state.model_manager.device,
        "batch_size": app_state.model_manager.batch_size,
        "effective_batch_size": app_state.model_manager.get_effective_batch_size(),
        "precision_mode": app_state.model_manager.precision_mode,
        "active_precision": app_state.model_manager.get_active_precision(),
        "fp16_supported": app_state.model_manager.check_fp16_support(),
        "gpu_name": app_state.model_manager.get_gpu_name(),
        "oom_triggered": app_state.model_manager.oom_triggered,
        "oom_triggered_count": app_state.model_manager.oom_triggered_count
    }

@router.post("/settings/gpu")
async def set_gpu_settings(req: GPUSettingsRequest):
    print(f"Set GPU settings requested: GPU={req.use_gpu}, Batch={req.batch_size}, Precision={req.precision_mode}")
    result = app_state.model_manager.set_device(req.use_gpu)
    app_state.model_manager.batch_size = max(0, req.batch_size)
    app_state.model_manager.precision_mode = req.precision_mode.lower()
    
    # Persist settings to .env
    settings_store.persist_gpu_settings(
        req.use_gpu, app_state.model_manager.batch_size, app_state.model_manager.precision_mode
    )

    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    
    res_dict = await get_gpu_settings()
    res_dict["status"] = "success"
    res_dict["message"] = result["message"]
    return res_dict
