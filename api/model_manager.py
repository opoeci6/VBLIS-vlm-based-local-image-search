import os
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModel
import gc
import time
import threading
from pathlib import Path
from model_downloader import ModelDownloader


class ModelManager:
    def __init__(self):
        self.current_model_id = None
        self.processor = None
        self.model = None
        
        # Read device and performance preferences from environment
        env_use_gpu = os.getenv("USE_GPU", "True").lower() == "true"
        cuda_available = torch.cuda.is_available()
        self.use_gpu = env_use_gpu and cuda_available
        self.device = "cuda" if self.use_gpu else "cpu"
        
        try:
            val = int(os.getenv("BATCH_SIZE", "0"))
            self.batch_size = max(0, val)
        except ValueError:
            self.batch_size = 0  # Default to 0 (Auto)
            
        self.precision_mode = os.getenv("PRECISION_MODE", "auto").lower()
        
        api_dir = Path(__file__).parent.resolve()
        hub_path = api_dir / "models" / "hub"
        self.downloader = ModelDownloader(hub_path)
        
        print(f"ModelManager initialized on {self.device} (Request GPU: {env_use_gpu}, Available: {cuda_available}, Configured Batch: {self.batch_size}, Precision Mode: {self.precision_mode})")
        self.is_loading_model = False
        self.oom_triggered = False
        self.oom_triggered_count = 0
        self._lock = threading.Lock()

    def get_effective_batch_size(self) -> int:
        """Calculate effective working batch size based on settings and available hardware/model."""
        if self.batch_size > 0:
            return self.batch_size
            
        # batch_size == 0 -> Auto Dynamic Calculation
        if not self.use_gpu or not torch.cuda.is_available():
            return 8  # CPU processing default
            
        try:
            total_vram_mb = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
            model_id = (self.current_model_id or "").lower()
            is_large_model = "so400m" in model_id or "384" in model_id or "naflex" in model_id
            
            if total_vram_mb >= 11000:   # 12GB+ GPUs
                return 32 if is_large_model else 64
            elif total_vram_mb >= 7000:  # 8GB GPUs
                return 16 if is_large_model else 32
            else:                        # <= 6GB GPUs
                return 8 if is_large_model else 16
        except Exception:
            return 16

    def check_fp16_support(self) -> bool:
        if not torch.cuda.is_available():
            return False
        try:
            major, minor = torch.cuda.get_device_capability()
            # Compute capability 7.5+ (Turing / Ampere / Ada Lovelace) has native FP16 Tensor Cores
            return major > 7 or (major == 7 and minor >= 5)
        except Exception:
            return False

    def get_gpu_name(self) -> str:
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
        return "N/A"

    def get_active_precision(self) -> str:
        if self.precision_mode == "fp16":
            return "fp16"
        elif self.precision_mode == "fp32":
            return "fp32"
        else: # "auto"
            return "fp16" if (self.use_gpu and self.check_fp16_support()) else "fp32"

    @property
    def is_downloading(self):
        return self.downloader.is_downloading

    @is_downloading.setter
    def is_downloading(self, val: bool):
        self.downloader.is_downloading = val

    @property
    def download_total_bytes(self):
        return self.downloader.download_total_bytes

    @property
    def download_current_bytes(self):
        return self.downloader.download_current_bytes

    @property
    def download_speed(self):
        return self.downloader.download_speed

    @property
    def download_eta(self):
        return self.downloader.download_eta

    @property
    def download_error(self):
        return self.downloader.download_error

    @download_error.setter
    def download_error(self, val):
        self.downloader.download_error = val

    @property
    def cancel_download(self):
        return self.downloader.cancel_requested

    @cancel_download.setter
    def cancel_download(self, val: bool):
        self.downloader.cancel_requested = val

    def load_model(self, model_id: str, local_files_only: bool = False):
        if self.current_model_id == model_id and self.model is not None:
            return

        if not local_files_only:
            print(f"Ensuring {model_id} is downloaded via ModelDownloader...")
            self.downloader.download_model(model_id)

        # Swap phase - LOCKED to ensure atomic switch
        with self._lock:
            # Check again if already loaded
            if self.current_model_id == model_id:
                return

            print(f"Loading model {model_id} on {self.device}...")
            
            # Unload old model
            old_model = self.model
            old_processor = self.processor
            
            # We don't set self.model = None here yet to keep it available as long as possible
            # but we must ensure we don't have two models on GPU at the same time if memory is tight.
            # However, AutoModel.from_pretrained...to(device) will allocate NEW memory.
            # So we SHOULD probably unload first if we are on GPU.
            
            if old_model is not None:
                print(f"Unloading previous model {self.current_model_id}...")
                self.model = None
                self.processor = None
                self.current_model_id = None
                del old_model
                del old_processor
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                gc.collect()

            self.is_loading_model = True
            try:
                self.processor = AutoProcessor.from_pretrained(model_id, use_fast=False, local_files_only=local_files_only)
                self.model = AutoModel.from_pretrained(model_id, local_files_only=local_files_only).to(self.device)
                self.model.eval()
                self.current_model_id = model_id
                print(f"Model {model_id} loaded successfully.")
            except Exception as e:
                # Clean up any partial load
                self.model = None
                self.processor = None
                self.current_model_id = None
                print(f"Failed to load model {model_id}: {e}")
                raise
            finally:
                self.is_loading_model = False

    def set_device(self, use_gpu: bool):
        """Toggle GPU usage and reload current model if necessary."""
        cuda_available = torch.cuda.is_available()
        new_use_gpu = use_gpu and cuda_available
        new_device = "cuda" if new_use_gpu else "cpu"
        
        if self.device == new_device:
            return {"status": "success", "message": f"Device already set to {self.device}", "device": self.device}

        print(f"Switching device from {self.device} to {new_device}...")
        
        # Update preference
        self.use_gpu = new_use_gpu
        self.device = new_device
        
        # If a model is loaded, we MUST reload it on the new device
        active_model = self.current_model_id
        if active_model:
            print(f"Reloading active model {active_model} on {self.device}...")
            # Reset current_model_id so load_model's early-return guard doesn't
            # skip the reload (the model is the same, but the device changed).
            self.current_model_id = None
            try:
                self.load_model(active_model, local_files_only=True)
            except Exception as e:
                print(f"Failed to reload model on new device: {e}")
                return {"status": "error", "message": f"Failed to reload model on {self.device}: {str(e)}", "device": self.device}

        return {"status": "success", "message": f"Switched to {self.device}", "device": self.device}

    def unload_model(self):
        """Free up GPU/RAM and reset state."""
        with self._lock:
            if not self.current_model_id:
                return
                
            print(f"Unloading model {self.current_model_id}...")
            self.current_model_id = None
            old_model = self.model
            old_processor = self.processor
            self.model = None
            self.processor = None
            
            if old_model is not None:
                del old_model
                del old_processor
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                gc.collect()
            print("Model unloaded successfully.")

    def get_collection_name(self) -> str:
        if not self.current_model_id:
            return "default_collection"
        return self.current_model_id.replace("/", "_").replace("-", "_")

    @torch.no_grad()
    def get_image_embeddings_batch(self, images: list[Image.Image]) -> list[list[float]]:
        if not images:
            return []

        # Atomic capture of model and processor
        with self._lock:
            model = self.model
            processor = self.processor
            
        if model is None or processor is None:
            raise RuntimeError("Model not loaded. Please select and download a model first.")

        # VRAM Guard: Prevent Windows WDDM from spilling dedicated VRAM allocations into System Shared Memory
        if self.use_gpu and torch.cuda.is_available() and len(images) > 1:
            try:
                free_bytes, total_bytes = torch.cuda.mem_get_info()
                reserved_bytes = torch.cuda.memory_reserved()
                allocated_bytes = torch.cuda.memory_allocated()
                cached_free = max(0, reserved_bytes - allocated_bytes)
                usable_free = free_bytes + cached_free
                
                # Windows DWM + Display OS overhead margin: ~850 MB / 15% reserved for display server
                min_free = max(850 * 1024 * 1024, int(total_bytes * 0.15))
                
                if free_bytes < min_free or usable_free < min_free:
                    torch.cuda.empty_cache()
                    gc.collect()
                    free_bytes, total_bytes = torch.cuda.mem_get_info()
                    reserved_bytes = torch.cuda.memory_reserved()
                    allocated_bytes = torch.cuda.memory_allocated()
                    usable_free = free_bytes + max(0, reserved_bytes - allocated_bytes)
                    
                    if free_bytes < min_free or usable_free < min_free:
                        mid = len(images) // 2
                        left_len, right_len = mid, len(images) - mid
                        print(f"[VRAM Guard] OS Free VRAM ({free_bytes / 1024**2:.1f} MB) / Usable ({usable_free / 1024**2:.1f} MB) < threshold ({min_free / 1024**2:.1f} MB). Micro-batching batch_size={len(images)} -> ({left_len}, {right_len})...")
                        self.oom_triggered = True
                        self.oom_triggered_count += 1
                        left_embeds = self.get_image_embeddings_batch(images[:mid])
                        right_embeds = self.get_image_embeddings_batch(images[mid:])
                        return left_embeds + right_embeds
            except Exception as e:
                pass

        rgb_images = [img.convert("RGB") if img.mode != "RGB" else img for img in images]

        try:
            inputs = processor(images=rgb_images, return_tensors="pt")
            model_device = next(model.parameters()).device
            inputs = {k: v.to(model_device) for k, v in inputs.items()}

            active_precision = self.get_active_precision()
            if active_precision == "fp16" and self.use_gpu:
                with torch.cuda.amp.autocast(dtype=torch.float16):
                    image_features = model.get_image_features(**inputs)
            else:
                image_features = model.get_image_features(**inputs)

            if hasattr(image_features, "image_embeds"):
                image_features = image_features.image_embeds
            elif hasattr(image_features, "pooler_output"):
                image_features = image_features.pooler_output

            if not isinstance(image_features, torch.Tensor) and isinstance(image_features, (list, tuple)):
                image_features = image_features[0]

            image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            return image_features.cpu().numpy().tolist()

        except torch.cuda.OutOfMemoryError as oom:
            self.oom_triggered = True
            self.oom_triggered_count += 1
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            gc.collect()

            if len(images) > 1:
                mid = len(images) // 2
                left_len, right_len = mid, len(images) - mid
                print(f"[OOM Warning] CUDA Out of memory (batch_size={len(images)}). Flushing cache and micro-batching -> ({left_len}, {right_len})...")
                left_embeds = self.get_image_embeddings_batch(images[:mid])
                right_embeds = self.get_image_embeddings_batch(images[mid:])
                return left_embeds + right_embeds
            else:
                print(f"[OOM Error] CUDA Out of memory on single item (batch_size=1).")
                raise oom

    @torch.no_grad()
    def get_image_embedding(self, image: Image.Image) -> list[float]:
        res = self.get_image_embeddings_batch([image])
        return res[0] if res else []

    @torch.no_grad()
    def get_text_embedding(self, text: str) -> list[float]:
        print(f"Generating text embedding for: {text[:20]}...")
        # Atomic capture of model and processor
        with self._lock:
            model = self.model
            processor = self.processor
            device = self.device
            
        if model is None or processor is None:
            raise RuntimeError("Model not loaded. Please select and download a model first.")

        inputs = processor(text=text, return_tensors="pt", padding="max_length")
        
        model_device = next(model.parameters()).device
        inputs = {k: v.to(model_device) for k, v in inputs.items()}
        
        print(f"Inference session (Text) on: {model_device}")
        text_features = model.get_text_features(**inputs)
        
        if hasattr(text_features, "text_embeds"):
            text_features = text_features.text_embeds
        elif hasattr(text_features, "pooler_output"):
            text_features = text_features.pooler_output
            
        if not isinstance(text_features, torch.Tensor) and isinstance(text_features, (list, tuple)):
            text_features = text_features[0]

        text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
        return text_features.cpu().numpy().flatten().tolist()

