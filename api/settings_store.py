import os
import tempfile

import paths


def update_env(updates: dict[str, str], env_path=None):
    """Set KEY=value lines in the .env file in one atomic write, leaving every other line as it was.
    Existing lines for a key are all replaced; keys not present yet are appended in dict order."""
    env_path = paths.ENV_FILE if env_path is None else env_path
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8", errors="surrogateescape", newline="") as f:
            lines = f.readlines()

    new_lines = []
    seen = set()
    for line in lines:
        for key, value in updates.items():
            if line.startswith(f"{key}="):
                new_lines.append(f"{key}={value}\n")
                seen.add(key)
                break
        else:
            new_lines.append(line)

    missing = [key for key in updates if key not in seen]
    if missing and new_lines and not new_lines[-1].endswith("\n"):
        new_lines[-1] += "\n"
    for key in missing:
        new_lines.append(f"{key}={updates[key]}\n")

    # Temp file next to the target so os.replace stays on one volume and is atomic
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(env_path)), prefix=".env.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape", newline="") as f:
            f.writelines(new_lines)
        os.replace(tmp_path, env_path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def persist_active_model(model_name: str):
    try:
        update_env({"ACTIVE_MODEL": model_name})
    except Exception as e:
        print(f"Failed to persist active model: {e}")


def persist_gpu_settings(use_gpu: bool, batch_size: int, precision_mode: str):
    try:
        update_env({
            "USE_GPU": str(use_gpu),
            "BATCH_SIZE": str(batch_size),
            "PRECISION_MODE": precision_mode,
        })
    except Exception as e:
        print(f"Failed to persist GPU settings: {e}")
