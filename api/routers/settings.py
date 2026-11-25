from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import app_state
import gpu_support
import settings_store

router = APIRouter()

class GPUSettingsRequest(BaseModel):
    use_gpu: bool
    batch_size: int = 0
    precision_mode: Literal["auto", "fp16", "fp32"] = "auto"

def _gpu_problem(check):
    """Why a present NVIDIA GPU isn't used (Settings explains it), or None."""
    if check.code is None:
        return None
    return {"code": check.code, "gpu_name": check.gpu_name, "capability": check.capability}

def _gpu_backend(cuda_check, mps_check):
    if cuda_check.usable:
        return "cuda"
    if mps_check.usable:
        return "mps"
    return None

@router.get("/settings/gpu")
def get_gpu_settings():
    cuda_check = gpu_support.check_cuda()
    mps_check = gpu_support.check_mps()
    backend = _gpu_backend(cuda_check, mps_check)
    return {
        "use_gpu": app_state.model_manager.use_gpu,
        # True when any GPU backend (CUDA or MPS) is usable so the Settings switch works on Macs too;
        # False also for an NVIDIA card or driver this PyTorch build can't run (gpu_problem then says why)
        "cuda_available": backend is not None,
        "gpu_backend": backend,
        "gpu_problem": _gpu_problem(cuda_check),
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
    if req.use_gpu and gpu_support.pick_device(True, probe=True) == "cpu":
        cuda_check = gpu_support.check_cuda(probe=True)
        if cuda_check.code:
            # Nothing changes: the GPU stays off and the settings are not saved
            return JSONResponse({"detail": f"The GPU can't be used ({cuda_check.code}): {cuda_check.detail}",
                                 "code": cuda_check.code}, status_code=409)
        mps_check = gpu_support.check_mps(probe=True)
        if mps_check.code:
            return JSONResponse({"detail": f"The GPU can't be used ({mps_check.code}): {mps_check.detail}",
                                 "code": mps_check.code}, status_code=409)
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
