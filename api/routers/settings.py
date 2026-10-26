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
def get_gpu_settings():
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
def set_gpu_settings(req: GPUSettingsRequest):
    print(f"Set GPU settings requested: GPU={req.use_gpu}, Batch={req.batch_size}, Precision={req.precision_mode}")
    # Set before set_device, so a device switch already reloads the model with the new precision
    app_state.model_manager.precision_mode = req.precision_mode.lower()
    result = app_state.model_manager.set_device(req.use_gpu)
    app_state.model_manager.batch_size = max(0, req.batch_size)
    precision_result = app_state.model_manager.set_precision_mode(req.precision_mode.lower())
    if result["status"] != "error" and precision_result["status"] == "error":
        result = precision_result
    
    # Persist settings to .env
    settings_store.persist_gpu_settings(
        req.use_gpu, app_state.model_manager.batch_size, app_state.model_manager.precision_mode
    )

    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    
    res_dict = get_gpu_settings()
    res_dict["status"] = "success"
    res_dict["message"] = result["message"]
    return res_dict
