import torch
from PIL import Image
from transformers import AutoProcessor, AutoModel
import gc
import time
import os
import threading
from pathlib import Path
from model_downloader import ModelDownloader


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
        
        api_dir = Path(__file__).parent.resolve()
        hub_path = api_dir / "models" / "hub"
        self.downloader = ModelDownloader(hub_path)
        
        print(f"ModelManager initialized on {self.device} (Request GPU: {env_use_gpu}, Available: {cuda_available})")
        self.is_loading_model = False
        self._lock = threading.Lock()

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

