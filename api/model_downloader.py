import os
import json
import time
import socket
import requests
from collections import deque
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_url

# Essential file extensions / names for Vision-Language Models
ESSENTIAL_EXACT_FILES = {
    "config.json",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "vocab.json",
    "vocab.txt",
    "merges.txt",
    "special_tokens_map.json",
    "spiece.model"
}

WEIGHT_EXTENSIONS = {".safetensors", ".bin"}

class ModelDownloader:
    def __init__(self, hub_path: Path):
        self.hub_path = hub_path
        self.is_downloading = False
        self.cancel_requested = False
        
        # Download metrics
        self.download_total_bytes = 0.0
        self.download_current_bytes = 0.0
        self.download_speed = 0.0
        self.download_eta = 0.0
        self.download_start_time = 0.0
        self._session_start_bytes = 0.0
        self._speed_window = deque()
        self.download_error = None
        self.current_download_model = None
        
        # Per-file byte tracking
        self._file_bytes = {}

    def get_model_folder_name(self, model_id: str) -> str:
        return f"models--{model_id.replace('/', '--')}"

    def get_model_path(self, model_id: str) -> Path:
        return self.hub_path / self.get_model_folder_name(model_id)

    def get_state_file_path(self, model_id: str) -> Path:
        return self.get_model_path(model_id) / ".download_state.json"

    def read_download_state(self, model_id: str) -> dict | None:
        state_file = self.get_state_file_path(model_id)
        if state_file.exists():
            try:
                with open(state_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def write_download_state(self, model_id: str, status: str, total_bytes: float = 0, current_bytes: float = 0, files_info: dict = None, error: str = None):
        model_path = self.get_model_path(model_id)
        model_path.mkdir(parents=True, exist_ok=True)
        state_file = self.get_state_file_path(model_id)
        
        state_data = {
            "model_id": model_id,
            "status": status,  # "downloading", "interrupted", "completed", "error"
            "total_bytes": total_bytes,
            "current_bytes": current_bytes,
            "files": files_info or {},
            "error": error,
            "updated_at": time.time()
        }
        
        try:
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump(state_data, f, indent=2)
        except Exception as e:
            print(f"Warning: Failed to write download state file: {e}")

    def inspect_model_status(self, model_id: str) -> dict:
        """
        Returns status dictionary for a given model_id:
        {
            "downloaded": bool,
            "incomplete": bool,
            "download_total_bytes": float,
            "download_current_bytes": float
        }
        """
        model_path = self.get_model_path(model_id)
        if not model_path.exists():
            return {
                "downloaded": False,
                "incomplete": False,
                "download_total_bytes": 0,
                "download_current_bytes": 0
            }

        state = self.read_download_state(model_id)
        snapshots_dir = model_path / "snapshots"
        
        # Check if snapshots contain valid model files
        has_config = False
        has_weights = False
        snapshot_files_size = 0.0

        if snapshots_dir.exists():
            for snapshot in snapshots_dir.iterdir():
                if snapshot.is_dir():
                    if (snapshot / "config.json").exists():
                        has_config = True
                    for file in snapshot.rglob("*"):
                        if file.is_file():
                            snapshot_files_size += file.stat().st_size
                            if file.name in ("model.safetensors", "pytorch_model.bin") or file.suffix in WEIGHT_EXTENSIONS:
                                has_weights = True

        is_completed_in_state = state and state.get("status") == "completed"
        
        if has_config and has_weights and (is_completed_in_state or not state):
            return {
                "downloaded": True,
                "incomplete": False,
                "download_total_bytes": snapshot_files_size,
                "download_current_bytes": snapshot_files_size
            }

        # Otherwise, if model path exists but it's not complete, it's incomplete
        total_bytes = state.get("total_bytes", 0) if state else 0
        current_bytes = state.get("current_bytes", snapshot_files_size) if state else snapshot_files_size

        return {
            "downloaded": False,
            "incomplete": True,
            "download_total_bytes": total_bytes,
            "download_current_bytes": current_bytes
        }

    def _select_required_files(self, siblings: list) -> list:
        """Select only necessary model files from repo sibling list."""
        required = []
        has_safetensors = any(s.rfilename == "model.safetensors" or s.rfilename.endswith(".safetensors") for s in siblings)
        
        for s in siblings:
            fname = s.rfilename
            # Skip hidden files, git files, README, onnx, msgpack, flax unless needed
            if fname.startswith(".") or fname.lower().startswith("readme"):
                continue
            if "onnx" in fname.lower() or "flax" in fname.lower() or "tf_" in fname.lower() or "open_clip" in fname.lower():
                continue
            
            # If safetensors is available, prefer safetensors over pytorch_model.bin to avoid downloading duplicate weights
            if has_safetensors and (fname == "pytorch_model.bin" or fname.endswith(".bin")):
                continue
                
            basename = os.path.basename(fname)
            ext = os.path.splitext(basename)[1].lower()
            
            if basename in ESSENTIAL_EXACT_FILES or ext in WEIGHT_EXTENSIONS or fname.endswith(".json") or fname.endswith(".txt"):
                required.append(s)

        # If no files matched our filter (rare edge case), fall back to all non-hidden files
        if not required:
            required = [s for s in siblings if not s.rfilename.startswith(".")]

        return required

    def download_model(self, model_id: str):
        """
        Download model files using HTTP chunk-by-chunk streaming.
        Supports resume via Range headers, cancellation check after every chunk,
        and automatic retries for socket timeouts.
        """
        self.is_downloading = True
        self.cancel_requested = False
        self.download_error = None
        self.current_download_model = model_id
        self._file_bytes = {}
        
        model_path = self.get_model_path(model_id)
        
        try:
            print(f"[ModelDownloader] Fetching metadata for {model_id}...")
            api = HfApi()
            model_info = api.model_info(model_id, files_metadata=True)
            commit_sha = getattr(model_info, "sha", None) or "main"
            
            if self.cancel_requested:
                raise RuntimeError("Download cancelled by user")

            # Standard HF hub cache directory layout: snapshots/<commit_sha> & refs/main
            snapshot_dir = model_path / "snapshots" / commit_sha
            snapshot_dir.mkdir(parents=True, exist_ok=True)
            
            refs_dir = model_path / "refs"
            refs_dir.mkdir(parents=True, exist_ok=True)
            try:
                with open(refs_dir / "main", "w", encoding="utf-8") as f:
                    f.write(commit_sha)
            except Exception as e:
                print(f"[ModelDownloader] Warning: Could not write refs/main: {e}")

            # Migrate legacy snapshots/main if present
            legacy_main_dir = model_path / "snapshots" / "main"
            if legacy_main_dir.exists() and legacy_main_dir != snapshot_dir:
                try:
                    print(f"[ModelDownloader] Migrating legacy files from snapshots/main to {commit_sha}...")
                    for legacy_file in legacy_main_dir.rglob("*"):
                        if legacy_file.is_file():
                            rel_path = legacy_file.relative_to(legacy_main_dir)
                            dest_file = snapshot_dir / rel_path
                            dest_file.parent.mkdir(parents=True, exist_ok=True)
                            if not dest_file.exists() or dest_file.stat().st_size < legacy_file.stat().st_size:
                                os.replace(legacy_file, dest_file)
                    try:
                        import shutil
                        shutil.rmtree(legacy_main_dir, ignore_errors=True)
                    except Exception:
                        pass
                except Exception as migrate_err:
                    print(f"[ModelDownloader] Legacy migration warning: {migrate_err}")

            required_siblings = self._select_required_files(model_info.siblings)
            
            total_expected_bytes = float(sum(s.size or 0 for s in required_siblings))
            self.download_total_bytes = total_expected_bytes
            self.download_start_time = time.time()
            
            files_info = {s.rfilename: s.size or 0 for s in required_siblings}
            self.write_download_state(model_id, "downloading", total_bytes=total_expected_bytes, current_bytes=0, files_info=files_info)

            # Pre-populate already downloaded byte counts
            for s in required_siblings:
                rfilename = s.rfilename
                target_file = snapshot_dir / rfilename
                if target_file.exists():
                    existing_size = target_file.stat().st_size
                    if existing_size >= (s.size or 0) and (s.size or 0) > 0:
                        self._file_bytes[rfilename] = float(s.size)
                    else:
                        self._file_bytes[rfilename] = float(existing_size)
                else:
                    self._file_bytes[rfilename] = 0.0

            self._session_start_bytes = sum(self._file_bytes.values())
            self._speed_window = deque()
            self._update_progress_metrics()

            session = requests.Session()
            session.headers.update({
                "User-Agent": "huggingface_hub/0.20.0 python/3.10 VBLIS/1.0"
            })

            chunk_size = 128 * 1024  # 128 KB chunks
            
            for s in required_siblings:
                rfilename = s.rfilename
                expected_size = s.size or 0
                target_file = snapshot_dir / rfilename
                target_file.parent.mkdir(parents=True, exist_ok=True)

                if target_file.exists():
                    existing_size = target_file.stat().st_size
                    if expected_size > 0 and existing_size >= expected_size:
                        print(f"[ModelDownloader] {rfilename} already complete ({existing_size} bytes). Skipping.")
                        self._file_bytes[rfilename] = float(expected_size)
                        self._update_progress_metrics()
                        continue
                else:
                    existing_size = 0

                file_url = hf_hub_url(repo_id=model_id, filename=rfilename)
                
                # Retry loop per file
                max_retries = 5
                retry_count = 0
                file_downloaded_successfully = False

                while retry_count < max_retries and not file_downloaded_successfully:
                    if self.cancel_requested:
                        raise RuntimeError("Download cancelled by user")

                    current_offset = target_file.stat().st_size if target_file.exists() else 0
                    headers = {}
                    if current_offset > 0:
                        headers["Range"] = f"bytes={current_offset}-"

                    print(f"[ModelDownloader] Downloading {rfilename} (Offset: {current_offset}/{expected_size})...")
                    
                    try:
                        # stream=True opens a single HTTP connection. Reading iter_content() streams over this single connection.
                        # timeout=(5.0, 10.0) ensures connect timeout is 5s, read timeout is 10s.
                        with session.get(file_url, headers=headers, stream=True, allow_redirects=True, timeout=(5.0, 10.0)) as response:
                            if response.status_code in (200, 206):
                                mode = "ab" if (response.status_code == 206 and current_offset > 0) else "wb"
                                if mode == "wb":
                                    current_offset = 0

                                with open(target_file, mode) as f:
                                    for chunk in response.iter_content(chunk_size=chunk_size):
                                        if self.cancel_requested:
                                            raise RuntimeError("Download cancelled by user")
                                        if chunk:
                                            f.write(chunk)
                                            current_offset += len(chunk)
                                            self._file_bytes[rfilename] = float(current_offset)
                                            self._update_progress_metrics()
                                            
                                file_downloaded_successfully = True
                            elif response.status_code == 416: # Range Not Satisfiable (file full)
                                self._file_bytes[rfilename] = float(expected_size)
                                self._update_progress_metrics()
                                file_downloaded_successfully = True
                            else:
                                response.raise_for_status()

                    except (requests.exceptions.RequestException, socket.timeout) as err:
                        retry_count += 1
                        print(f"[ModelDownloader] Network glitch on {rfilename} (Attempt {retry_count}/{max_retries}): {err}")
                        if self.cancel_requested:
                            raise RuntimeError("Download cancelled by user")
                        if retry_count >= max_retries:
                            raise RuntimeError(f"Failed downloading {rfilename} after {max_retries} retries: {err}")
                        time.sleep(1.0 * retry_count)

            # All required files completed
            self.clean_incomplete_files(model_id)
            self.write_download_state(model_id, "completed", total_bytes=self.download_total_bytes, current_bytes=self.download_total_bytes, files_info=files_info)
            self.download_speed = 0.0
            self.download_eta = 0.0
            print(f"[ModelDownloader] Successfully finished downloading {model_id}")

        except Exception as e:
            err_msg = str(e)
            print(f"[ModelDownloader] Error during download: {err_msg}")
            if "cancelled by user" in err_msg.lower():
                self.write_download_state(model_id, "interrupted", total_bytes=self.download_total_bytes, current_bytes=self.download_current_bytes, error="Download cancelled by user")
            else:
                self.write_download_state(model_id, "interrupted", total_bytes=self.download_total_bytes, current_bytes=self.download_current_bytes, error=err_msg)
            self.download_error = err_msg
            raise
        finally:
            self.is_downloading = False
            self.cancel_requested = False

    def clean_incomplete_files(self, model_id: str):
        """Purge temporary *.incomplete files left in blobs or snapshots by previous downloads."""
        model_path = self.get_model_path(model_id)
        if model_path.exists():
            for inc_file in model_path.rglob("*.incomplete"):
                try:
                    inc_file.unlink()
                    print(f"[ModelDownloader] Cleaned up temporary file: {inc_file}")
                except Exception as e:
                    print(f"[ModelDownloader] Failed to remove temporary file {inc_file}: {e}")

    def _update_progress_metrics(self):
        self.download_current_bytes = sum(self._file_bytes.values())
        if self.download_total_bytes > 0 and self.download_current_bytes > self.download_total_bytes:
            self.download_total_bytes = self.download_current_bytes
            
        now = time.time()
        # Session downloaded bytes (bytes downloaded over the wire during THIS active session only)
        session_bytes = max(0.0, self.download_current_bytes - getattr(self, "_session_start_bytes", 0.0))
        
        if not hasattr(self, "_speed_window") or self._speed_window is None:
            self._speed_window = deque()
            
        self._speed_window.append((now, session_bytes))
        
        # Keep window size within last 3 seconds
        while len(self._speed_window) > 1 and (now - self._speed_window[0][0]) > 3.0:
            self._speed_window.popleft()
            
        if len(self._speed_window) > 1:
            time_delta = self._speed_window[-1][0] - self._speed_window[0][0]
            bytes_delta = self._speed_window[-1][1] - self._speed_window[0][1]
            if time_delta > 0.3 and bytes_delta >= 0:
                self.download_speed = bytes_delta / time_delta
            else:
                elapsed = now - self.download_start_time
                self.download_speed = (session_bytes / elapsed) if elapsed > 0.5 else 0.0
        else:
            elapsed = now - self.download_start_time
            self.download_speed = (session_bytes / elapsed) if elapsed > 0.5 else 0.0

        if self.download_total_bytes > 0 and self.download_speed > 0:
            remaining = max(0.0, self.download_total_bytes - self.download_current_bytes)
            self.download_eta = remaining / self.download_speed
        else:
            self.download_eta = 0.0
