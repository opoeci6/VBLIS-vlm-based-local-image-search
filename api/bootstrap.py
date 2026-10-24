# Import-time process setup. Must run before model_manager is imported: transformers reads HF_HOME
# when it loads, so the environment has to be final by then. app_state imports this first.
import os
import sys
import pillow_heif
from dotenv import load_dotenv

# Electron reads our stdout/stderr pipes as UTF-8, but they default to the ANSI code page, so
# printing a path it can't encode would raise. The frozen build ignores PYTHONUTF8/PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")

pillow_heif.register_heif_opener()

# Ensure we load the .env from the data root (see paths.py), and strictly enforce HF_HOME
import paths
import security
# Packaged builds only: move data an older build kept in the install folder (before anything opens it)
try:
    _migration = paths.migrate_legacy_data()
except paths.MigrationLockedError as e:
    sys.exit(f"[DataMigration] {e}; not starting.")
if "failed" in _migration.values():
    # Starting now would create fresh, empty state next to the half-migrated data; exit so the
    # next launch retries the move instead of shadowing the old copy forever
    failed = ", ".join(name for name, outcome in _migration.items() if outcome == "failed")
    sys.exit(f"[DataMigration] Could not move {failed} into {paths.DATA_ROOT}; not starting.")
# The token comes only from the launching process, never from .env (which overrides the environment)
API_TOKEN = security.resolve_api_token()
load_dotenv(paths.ENV_FILE, override=True)
os.environ["HF_HOME"] = str(paths.MODELS_DIR)
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "30"
os.environ["HF_HUB_ENABLE_EMERGENCY_RETRY"] = "False"

paths.ensure_dirs()
