import os
from pathlib import Path
from typing import Optional, List, Dict, Any, NamedTuple

import paths

# Ensure HF_HOME is configured to local models directory before importing transformers
if "HF_HOME" not in os.environ:
    os.environ["HF_HOME"] = str(paths.MODELS_DIR)
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import torch
from PIL import Image
from transformers import AutoProcessor, AutoModel
import gc
import time
import threading
from model_downloader import ModelDownloader

try:
    from transformers.models.siglip2.image_processing_siglip2 import get_image_size_for_max_num_patches
except ImportError:  # the pre-resize is then simply skipped
    get_image_size_for_max_num_patches = None

# The only models the API will download, switch to or delete
AVAILABLE_MODELS = (
    "google/siglip2-base-patch16-224",
    "google/siglip2-base-patch16-naflex",
    "google/siglip2-so400m-patch14-384",
    "google/siglip2-so400m-patch16-naflex",
    "openai/clip-vit-base-patch32",
)


class PreparedImage(NamedTuple):
    """CPU-side processor output for one image, tagged with the model it was prepared for."""
    model_id: Optional[str]
    inputs: Dict[str, Any]


class ModelManager:
    def __init__(self, hub_path=None):
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
        
        if hub_path is None:
            hub_path = paths.HUB_DIR
        self.downloader = ModelDownloader(hub_path)
        
        print(f"ModelManager initialized on {self.device} (Request GPU: {env_use_gpu}, Available: {cuda_available}, Configured Batch: {self.batch_size}, Precision Mode: {self.precision_mode})")
        self.is_loading_model = False
        self.oom_triggered = False
        self.oom_triggered_count = 0
        self._lock = threading.Lock()

    @property
    def active_model(self) -> Optional[str]:
        return self.current_model_id

    @active_model.setter
    def active_model(self, value: Optional[str]):
        self.current_model_id = value

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

    def get_model_snapshot_path(self, model_id: str) -> Path | None:
        """Resolve the local snapshot directory containing model files if available."""
        model_path = self.downloader.get_model_path(model_id)
        if not model_path.exists():
            return None

        # 1. Check refs/main commit SHA
        refs_main = model_path / "refs" / "main"
        if refs_main.exists():
            try:
                commit_sha = refs_main.read_text(encoding="utf-8").strip()
                target_dir = model_path / "snapshots" / commit_sha
                if target_dir.exists() and (target_dir / "config.json").exists():
                    return target_dir
            except Exception:
                pass

        # 2. Check any valid snapshot directory
        snapshots_dir = model_path / "snapshots"
        if snapshots_dir.exists():
            for d in snapshots_dir.iterdir():
                if d.is_dir() and (d / "config.json").exists():
                    return d

        return None

    def load_model(self, model_id: str, local_files_only: bool = False):
        if self.current_model_id == model_id and self.model is not None:
            return

        if not local_files_only:
            status_info = self.downloader.inspect_model_status(model_id)
            snapshot_dir = self.get_model_snapshot_path(model_id)
            if not (status_info["downloaded"] and snapshot_dir is not None):
                print(f"Ensuring {model_id} is downloaded via ModelDownloader...")
                self.downloader.download_model(model_id)

        # Swap phase - LOCKED to ensure atomic switch
        with self._lock:
            # Check again if already loaded
            if self.current_model_id == model_id and self.model is not None:
                return

            print(f"Loading model {model_id} on {self.device}...")
            
            # Unload old model
            old_model = self.model
            old_processor = self.processor
            
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
                snapshot_path = self.get_model_snapshot_path(model_id)
                if snapshot_path is not None:
                    load_target = str(snapshot_path)
                elif local_files_only:
                    raise FileNotFoundError(f"Model '{model_id}' is not downloaded locally.")
                else:
                    load_target = model_id

                print(f"Loading processor and model weights from: {load_target}")
                self.processor = AutoProcessor.from_pretrained(load_target, use_fast=False, local_files_only=True)
                self.model = AutoModel.from_pretrained(load_target, local_files_only=True).to(self.device)
                self.model.eval()
                self.current_model_id = model_id
                print(f"Model {model_id} loaded successfully from {load_target}.")
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

    def prepare_image(self, image: Image.Image) -> PreparedImage:
        """Run the (CPU-only) processor for one image. Thread-safe: safe to call from worker threads.

        For naflex processors the image is first resized with PIL to the exact size the processor would
        pick itself. PIL's resize releases the GIL and the processor's own resize then becomes a plain
        same-size copy, so the resulting tensors are bit-identical but much cheaper to produce.
        """
        # Atomic capture of model id and processor (the model itself is not kept alive by a worker)
        with self._lock:
            model_id = self.current_model_id
            model_loaded = self.model is not None
            processor = self.processor

        if not model_loaded or processor is None:
            raise RuntimeError("Model not loaded. Please select and download a model first.")

        rgb = image.convert("RGB") if image.mode != "RGB" else image
        resized = None
        try:
            pre = self._exact_naflex_resize(processor, rgb)
            if pre is not None:
                resized, expected_shape = pre
                inputs = processor(images=[resized], return_tensors="pt")
                # Belt and braces: the processor must have kept our size (a same-size copy); otherwise it
                # resized again with other parameters, so redo it on the untouched image.
                if self._spatial_shape(inputs) != expected_shape:
                    inputs = processor(images=[rgb], return_tensors="pt")
            else:
                inputs = processor(images=[rgb], return_tensors="pt")
            return PreparedImage(model_id, {k: v for k, v in inputs.items()})
        finally:
            # Only close intermediates created here, never the caller's image
            if resized is not None:
                resized.close()
            if rgb is not image:
                rgb.close()

    @staticmethod
    def _spatial_shape(inputs) -> Optional[tuple]:
        try:
            return tuple(int(v) for v in inputs["spatial_shapes"][0].tolist())
        except Exception:
            return None

    @staticmethod
    def _naflex_params(processor):
        """(patch_size, max_num_patches, resample) a naflex processor really applies, else None."""
        image_processor = getattr(processor, "image_processor", None)
        if not getattr(image_processor, "max_num_patches", None):
            return None
        effective = {
            "patch_size": getattr(image_processor, "patch_size", None),
            "max_num_patches": image_processor.max_num_patches,
            "resample": getattr(image_processor, "resample", None),
            "do_resize": getattr(image_processor, "do_resize", False),
        }
        if hasattr(processor, "_merge_kwargs"):
            # A real ProcessorMixin passes its own defaults (e.g. max_num_patches=256, patch_size=16) to the
            # image processor, overriding the image processor's own config. Ask it what it will really pass.
            try:
                merged = processor._merge_kwargs(
                    processor.valid_processor_kwargs,
                    tokenizer_init_kwargs=processor.tokenizer.init_kwargs,
                )["images_kwargs"]
            except Exception:
                return None
            effective.update({k: merged[k] for k in effective if k in merged})
        if not effective["do_resize"] or effective["resample"] is None:
            return None
        if not effective["patch_size"] or not effective["max_num_patches"]:
            return None
        return effective["patch_size"], effective["max_num_patches"], effective["resample"]

    @staticmethod
    def _exact_naflex_resize(processor, rgb: Image.Image):
        """PIL pre-resize matching what a naflex processor does itself.

        Returns (resized_image, expected_spatial_shape) or None when not applicable.
        """
        if get_image_size_for_max_num_patches is None:
            return None
        params = ModelManager._naflex_params(processor)
        if params is None:
            return None
        patch_size, max_num_patches, resample = params
        width, height = rgb.size
        target_h, target_w = get_image_size_for_max_num_patches(height, width, patch_size, max_num_patches)
        # Safety net: only when the target size is a fixed point is the processor's own resize a same-size copy
        if get_image_size_for_max_num_patches(target_h, target_w, patch_size, max_num_patches) != (target_h, target_w):
            return None
        if (target_w, target_h) == rgb.size:
            return None
        expected_shape = (target_h // patch_size, target_w // patch_size)
        return rgb.resize((target_w, target_h), resample=resample), expected_shape

    @torch.no_grad()
    def embed_prepared(self, items: list[PreparedImage], task_context=None) -> list[list[float]]:
        if not items:
            return []

        if task_context and not task_context.check_paused_or_cancelled():
            return []

        # Atomic capture of model
        with self._lock:
            model = self.model
            model_id = self.current_model_id

        if model is None:
            raise RuntimeError("Model not loaded. Please select and download a model first.")

        if any(item.model_id != model_id for item in items):
            raise RuntimeError("The active model changed while images were being prepared. Please retry.")

        # VRAM Guard: Prevent Windows WDDM from spilling dedicated VRAM allocations into System Shared Memory
        run_singly = False
        if self.use_gpu and torch.cuda.is_available() and len(items) > 1:
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
                        # The free-VRAM condition does not depend on the batch size, so halving would end up
                        # at batches of 1 anyway (paying a cleanup per split). Go there directly, cleaning once.
                        print(f"[VRAM Guard] OS Free VRAM ({free_bytes / 1024**2:.1f} MB) / Usable ({usable_free / 1024**2:.1f} MB) < threshold ({min_free / 1024**2:.1f} MB). Micro-batching batch_size={len(items)} -> {len(items)} singles...")
                        self.oom_triggered = True
                        self.oom_triggered_count += len(items) - 1
                        run_singly = True
            except Exception as e:
                pass

        if run_singly:
            results: list[list[float]] = []
            for item in items:
                if task_context and not task_context.check_paused_or_cancelled():
                    return results
                results.extend(self._embed_chunk(model, [item], task_context))
            return results

        if task_context and not task_context.check_paused_or_cancelled():
            return []

        return self._embed_chunk(model, items, task_context)

    @torch.no_grad()
    def _embed_chunk(self, model, items: list[PreparedImage], task_context=None) -> list[list[float]]:
        """Forward one chunk of prepared images; on CUDA OOM, halve recursively (a single item re-raises)."""
        try:
            if len(items) == 1:
                inputs = items[0].inputs
            else:
                inputs = {k: torch.cat([item.inputs[k] for item in items]) for k in items[0].inputs}
            model_device = next(model.parameters()).device
            inputs = {k: v.to(model_device) for k, v in inputs.items()}

            active_precision = self.get_active_precision()
            if active_precision == "fp16" and self.use_gpu:
                with torch.autocast("cuda", dtype=torch.float16):
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

            if len(items) > 1:
                mid = len(items) // 2
                left_len, right_len = mid, len(items) - mid
                print(f"[OOM Warning] CUDA Out of memory (batch_size={len(items)}). Flushing cache and micro-batching -> ({left_len}, {right_len})...")
                left_embeds = self.embed_prepared(items[:mid], task_context=task_context)
                if task_context and not task_context.check_paused_or_cancelled():
                    return left_embeds
                right_embeds = self.embed_prepared(items[mid:], task_context=task_context)
                return left_embeds + right_embeds
            else:
                print(f"[OOM Error] CUDA Out of memory on single item (batch_size=1).")
                raise oom

    @torch.no_grad()
    def get_image_embeddings_batch(self, images: list[Image.Image], task_context=None) -> list[list[float]]:
        if not images:
            return []

        if task_context and not task_context.check_paused_or_cancelled():
            return []

        return self.embed_prepared([self.prepare_image(img) for img in images], task_context=task_context)

    @torch.no_grad()
    def get_image_embedding(self, image: Image.Image, task_context=None) -> list[float]:
        res = self.get_image_embeddings_batch([image], task_context=task_context)
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

