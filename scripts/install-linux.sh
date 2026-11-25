#!/usr/bin/env bash
# Install the VBLIS server from this source folder on Linux or macOS (Apple Silicon, macOS 14+),
# into a private Python environment. Nothing is installed system-wide and no sudo is needed. See SERVER.md.
#
#   scripts/install-linux.sh [--torch cpu|cuda] [--data-dir DIR] [--python PYTHON | --fetch-python] [--web-zip FILE] [--no-service]
#
#   --torch cpu     PyTorch without CUDA (the default; on macOS this includes Apple GPU / MPS,
#                   and on Linux ARM64 it is the only choice)
#   --torch cuda    PyTorch with NVIDIA CUDA 13.0 (Linux x86-64 only; GTX 16 / RTX 20 or newer,
#                   driver 580 or newer; a few GB more to download)
#   --data-dir      where models, the index and the settings live (default ~/.local/share/vblis)
#   --python        the Python to build the environment with (3.11 to 3.13; default python3)
#   --fetch-python  download a pinned standalone CPython 3.11 into <data-dir>/python and use it
#   --web-zip       the web interface from a release (VBLIS-web-<version>.zip), unpacked into app/dist;
#                   use it when Node.js isn't installed
#   --no-service    don't write the systemd user service (Linux)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$REPO/api"
VENV="$API/.venv"
TORCH="cpu"
PYTHON="python3"
FETCH_PYTHON=0
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/vblis"
WEB_ZIP=""
SERVICE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --torch) TORCH="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --python) PYTHON="${2:-}"; shift 2 ;;
    --fetch-python) FETCH_PYTHON=1; shift ;;
    --web-zip) WEB_ZIP="${2:-}"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$OS" = "Darwin" ]; then
  MAC_VER="$(sw_vers -productVersion 2>/dev/null || true)"
  MAC_MAJOR="${MAC_VER%%.*}"
  case "$MAC_MAJOR" in
    ''|*[!0-9]*) MAC_MAJOR=0 ;;
  esac
  if [ "$ARCH" != "arm64" ] || [ "$MAC_MAJOR" -lt 14 ]; then
    fail "VBLIS needs a Mac with Apple Silicon and macOS 14 or newer."
  fi
fi

# Fail early on a wrong choice; linux-deps.sh checks the same again when it installs PyTorch
case "$TORCH" in
  cpu) ;;
  cuda)
    if [ "$OS" = "Darwin" ]; then
      fail "CUDA builds of PyTorch are not available on macOS (use --torch cpu; it includes Apple GPU / MPS)."
    fi
    [ "$ARCH" = "x86_64" ] || fail "CUDA builds of PyTorch exist for x86-64 only." ;;
  *) fail "--torch must be cpu or cuda" ;;
esac
if [ -n "$WEB_ZIP" ] && [ ! -f "$WEB_ZIP" ]; then fail "--web-zip: $WEB_ZIP is not a file."; fi
DATA_DIR="$(mkdir -p "$DATA_DIR" && cd "$DATA_DIR" && pwd)"
chmod 700 "$DATA_DIR"

PY_RELEASE="20261124"
PY_BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/$PY_RELEASE"

fetch_standalone_python() {
  local file sha url tmp_dir archive got
  case "$OS/$ARCH" in
    Darwin/arm64)
      file="cpython-3.11.18+20261124-aarch64-apple-darwin-install_only.tar.gz"
      sha="89ce773f5eb6f072ceea3a30d86258ecd5d02ea0f8e87fda0b940b9067aebf81" ;;
    Linux/aarch64)
      file="cpython-3.11.18+20261124-aarch64-unknown-linux-gnu-install_only.tar.gz"
      sha="27ebaf6273019745f29dbaaa318d9e3686cc89dbfe6405c15b4667db40847819" ;;
    Linux/x86_64)
      file="cpython-3.11.18+20261124-x86_64-unknown-linux-gnu-install_only.tar.gz"
      sha="ef0764e884b5e123692281b91bf388f8ebfd0afb41d6a212bb4f2779e51abf0e" ;;
    *)
      fail "--fetch-python is not supported on $OS/$ARCH." ;;
  esac

  if [ -x "$DATA_DIR/python/bin/python3" ]; then
    echo "Using existing standalone Python at $DATA_DIR/python/bin/python3"
    return 0
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is required for --fetch-python."
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    fail "sha256sum or shasum is required to verify the standalone Python download."
  fi

  say "Standalone Python ($OS/$ARCH)"
  tmp_dir="$(mktemp -d "$DATA_DIR/.python-download.XXXXXX")"
  PY_TMP_DIR="$tmp_dir"
  trap 'if [ -n "${PY_TMP_DIR:-}" ]; then rm -rf "$PY_TMP_DIR"; fi' EXIT
  archive="$tmp_dir/$file"
  url="$PY_BASE_URL/$file"
  echo "Downloading $url"
  curl -fL -o "$archive" "$url"

  if command -v sha256sum >/dev/null 2>&1; then
    got="$(sha256sum "$archive" | awk '{print $1}')"
  else
    got="$(shasum -a 256 "$archive" | awk '{print $1}')"
  fi
  if [ "$got" != "$sha" ]; then
    fail "SHA-256 mismatch for $file (expected $sha, got $got)."
  fi

  tar -xzf "$archive" -C "$tmp_dir"
  [ -x "$tmp_dir/python/bin/python3" ] || fail "Unpacking $file did not produce python/bin/python3."
  rm -rf "$DATA_DIR/python"
  mv "$tmp_dir/python" "$DATA_DIR/python"
  rm -rf "$tmp_dir"
  PY_TMP_DIR=""
  trap - EXIT
}

if [ "$FETCH_PYTHON" = 1 ]; then
  fetch_standalone_python
  PYTHON="$DATA_DIR/python/bin/python3"
fi

say "Python environment ($VENV)"
if [ ! -x "$VENV/bin/python" ]; then
  if "$PYTHON" -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null \
      && "$PYTHON" -m venv "$VENV" 2>/dev/null; then
    :
  elif command -v uv >/dev/null 2>&1; then
    echo "Using uv to create the environment with Python 3.11."
    rm -rf "$VENV"
    uv venv --seed --python 3.11 "$VENV"
  else
    rm -rf "$VENV"
    fail "Python 3.11 to 3.13 with venv is needed. Re-run with --fetch-python, or on Debian/Ubuntu: sudo apt install python3-venv python3-pip"
  fi
fi
PY="$VENV/bin/python"
"$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade >/dev/null 2>&1 \
  || fail "The environment has no pip. Remove $VENV and install python3-venv (or uv), then run this again."
echo "$("$PY" --version) on $ARCH"

# PyTorch, the other packages and a dependency check (the same script builds the Docker image)
bash "$REPO/scripts/linux-deps.sh" --python "$PY" --torch "$TORCH" --api "$API"

say "Web interface"
if [ -n "$WEB_ZIP" ]; then
  # Unpack beside the target and swap it in only when the zip checks out
  "$PY" - "$WEB_ZIP" "$REPO/app/dist" <<'PYEOF'
import os
import shutil
import sys
import tempfile
import zipfile

zip_path, dest = sys.argv[1], sys.argv[2]


def refuse(message):
    sys.exit("Error: " + message)


try:
    archive = zipfile.ZipFile(zip_path)
except (zipfile.BadZipFile, OSError) as e:
    refuse("%s is not a readable zip file (%s)" % (zip_path, e))
with archive:
    names = archive.namelist()
    if "index.html" not in names:
        refuse("%s has no index.html at its top level. Use the VBLIS-web-<version>.zip from a release." % zip_path)
    for name in names:
        path = name.replace("\\", "/")
        if path.startswith("/") or (len(path) > 1 and path[1] == ":") or ".." in path.split("/"):
            refuse("%s holds an unsafe path (%s); not unpacking it." % (zip_path, name))
    bad = archive.testzip()
    if bad:
        refuse("%s is damaged (%s); download it again." % (zip_path, bad))
    parent = os.path.dirname(dest)
    os.makedirs(parent, exist_ok=True)
    staging = tempfile.mkdtemp(prefix=".dist-new-", dir=parent)
    try:
        archive.extractall(staging)
        if not os.path.isfile(os.path.join(staging, "index.html")):
            refuse("unpacking %s did not produce an index.html" % zip_path)
        old = None
        if os.path.exists(dest):
            old = dest + ".old"
            shutil.rmtree(old, ignore_errors=True)
            os.rename(dest, old)
        os.chmod(staging, 0o755)
        os.rename(staging, dest)
        staging = None
        if old:
            shutil.rmtree(old, ignore_errors=True)
    finally:
        if staging:
            shutil.rmtree(staging, ignore_errors=True)
print("Unpacked %s into %s" % (zip_path, dest))
PYEOF
elif [ -f "$REPO/app/dist/index.html" ]; then
  echo "Found $REPO/app/dist"
elif command -v npm >/dev/null 2>&1; then
  (cd "$REPO/app" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build)
else
  echo "Not found, and Node.js isn't installed. Either download VBLIS-web-<version>.zip from the release page and run"
  echo "  scripts/install-linux.sh --web-zip VBLIS-web-<version>.zip"
  echo "or build it on any machine with Node.js 22:"
  echo "  cd app && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build"
  echo "and copy app/dist here, to $REPO/app/dist. The server runs without it but shows only a note."
fi

say "Check"
"$PY" -c 'import torch, chromadb, transformers, PIL, pillow_heif, av, cv2, cryptography; mps = getattr(getattr(torch, "backends", None), "mps", None); print("torch", torch.__version__, "- CUDA available:", torch.cuda.is_available(), "- MPS available:", bool(mps and mps.is_available()))'

RUN=("$PY" "$API/main.py" --data-dir "$DATA_DIR")
if [ "$SERVICE" = 1 ] && command -v systemctl >/dev/null 2>&1; then
  say "systemd user service"
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/vblis.service" <<EOF
[Unit]
Description=VBLIS image and video search server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$API
Environment=PYTHONUNBUFFERED=1
ExecStart=$PY $API/main.py --data-dir $DATA_DIR serve
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
  echo "Wrote $UNIT_DIR/vblis.service"
fi

if [ "$OS" = "Darwin" ]; then
  cat <<EOF

Installed. Next steps:
  1. Add an owner account (it asks for the password twice). You can add viewers now or later in the browser:
       ${RUN[*]} add-account NAME --role owner
       ${RUN[*]} add-account NAME --role viewer
  2. Allow the folders browsers may index:
       ${RUN[*]} add-library-folder /path/to/photos
  3. HTTPS is on, with a certificate the server makes itself; browsers warn on the first visit.
     Other choices (your own certificate, a reverse proxy) are in SERVER.md. Plain HTTP, only on a
     network you trust:
       ${RUN[*]} set tls off
  4. Start it:
       ${RUN[*]} serve
  5. Open the address it prints (on this Mac, https://localhost:8080) in a browser and sign in. Download a model in Settings.
EOF
else
  cat <<EOF

Installed. Next steps:
  1. Add an owner account (it asks for the password twice). You can add viewers now or later in the browser:
       ${RUN[*]} add-account NAME --role owner
       ${RUN[*]} add-account NAME --role viewer
  2. Allow the folders browsers may index:
       ${RUN[*]} add-library-folder /path/to/photos
  3. HTTPS is on, with a certificate the server makes itself; browsers warn on the first visit.
     Other choices (your own certificate, a reverse proxy) are in SERVER.md. Plain HTTP, only on a
     network you trust:
       ${RUN[*]} set tls off
  4. Start it:
       ${RUN[*]} serve
     or as a service:
       systemctl --user daemon-reload && systemctl --user enable --now vblis
       sudo loginctl enable-linger ${USER:-$(id -un)}    # keeps it running after you log out
  5. Open https://<this machine's address>:8080 in a browser and sign in. Download a model in Settings.
EOF
fi
