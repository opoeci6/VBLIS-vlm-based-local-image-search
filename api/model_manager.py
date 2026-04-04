import torch
from PIL import Image
from transformers import AutoProcessor, AutoModel
from huggingface_hub import hf_hub_download, HfApi, snapshot_download
from tqdm.auto import tqdm
import gc
import time
import os
import threading


class ModelManager:
    def __init__(self):
        self.current_model_id = None
        self.processor = None
        self.model = None
        
        # Read device preference from environment
        env_use_gpu = os.getenv("USE_GPU", "True").lower() == "true"
        cuda_available = torch.cuda.is_available()
        self.use_gpu = env_use_gpu and cuda_available
        self.device = "cuda" if self.use_gpu else "cpu"
        
        print(f"ModelManager initialized on {self.device} (Request GPU: {env_use_gpu}, Available: {cuda_available})")
        
        self.is_downloading = False
        
        # Download metrics
        self.download_total_bytes = 0.0
        self.download_current_bytes = 0.0
        self.download_speed = 0.0
        self.download_eta = 0.0
        self.download_start_time = 0.0
        self.download_error = None
        self.cancel_download = False
        self.is_loading_model = False
        self._lock = threading.Lock()
        
    def _update_progress(self, delta_bytes: float):
        """Update download progress metrics."""
        self.download_current_bytes += delta_bytes
        
        if self.download_total_bytes > 0 and self.download_current_bytes > self.download_total_bytes:
            self.download_total_bytes = self.download_current_bytes + 1024
            
        elapsed = time.time() - self.download_start_time
        if elapsed > 0:
            self.download_speed = self.download_current_bytes / elapsed
            if self.download_total_bytes > 0:
                remaining = float(self.download_total_bytes - self.download_current_bytes)
                self.download_eta = max(0.0, remaining / self.download_speed) if self.download_speed > 0 else 0.0
            else:
                self.download_eta = 0.0

    def load_model(self, model_id: str, local_files_only: bool = False):
        if self.current_model_id == model_id:
            return
            
        self.download_error = None
        self.cancel_download = False

        if not local_files_only:
            print(f"Ensuring {model_id} is downloaded...")
            
            # Get repo file list and sizes
            api = HfApi()
            model_info = api.model_info(model_id, files_metadata=True)
            if self.cancel_download:
                raise RuntimeError("Download cancelled")

            self.download_total_bytes = float(sum(s.size or 0 for s in model_info.siblings))
            self.download_current_bytes = 0.0
            self.download_eta = 0.0
            self.download_start_time = time.time()
            
            # snapshot_download handles the download for all files in the repo.
            class ProgressHook(tqdm):
                def __init__(inner_self, *args, **kwargs):
                    kwargs['disable'] = True
                    super().__init__(*args, **kwargs)
                    
                def update(inner_self, n=1):
                    if self.cancel_download:
                        raise RuntimeError("Download cancelled")
                    # Use a lock-free update for progress metrics as they are mostly for polling
                    self._update_progress(float(n))
                    return super().update(n)

            snapshot_download(
                repo_id=model_id,
                tqdm_class=ProgressHook,
                max_workers=1 
            )
            
            self.download_speed = 0.0
            self.download_eta = 0.0

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
    def get_image_embedding(self, image: Image.Image) -> list[float]:
        print("Generating image embedding...")
        # Atomic capture of model and processor
        with self._lock:
            model = self.model
            processor = self.processor
            device = self.device
            
        if model is None or processor is None:
            raise RuntimeError("Model not loaded. Please select and download a model first.")

        # Convert to RGB just in case it's RGBA or Grayscale
        if image.mode != "RGB":
            image = image.convert("RGB")
            
        inputs = processor(images=image, return_tensors="pt")
        
        model_device = next(model.parameters()).device
        inputs = {k: v.to(model_device) for k, v in inputs.items()}
        
        print(f"Inference session (Image) on: {model_device}")
        image_features = model.get_image_features(**inputs)
        
        # Extract embeddings depending on the model output structure
        if hasattr(image_features, "image_embeds"):
            image_features = image_features.image_embeds
        elif hasattr(image_features, "pooler_output"):
            image_features = image_features.pooler_output
            
        if not isinstance(image_features, torch.Tensor) and isinstance(image_features, (list, tuple)):
            image_features = image_features[0]

        image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
        return image_features.cpu().numpy().flatten().tolist()

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

