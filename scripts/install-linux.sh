#!/usr/bin/env bash
# Install the VBLIS server from this source folder on Linux, into a private Python environment.
# Nothing is installed system-wide and no sudo is needed. See SERVER.md.
#
#   scripts/install-linux.sh [--torch cpu|cuda] [--data-dir DIR] [--python PYTHON] [--no-service]
#
#   --torch cpu    PyTorch without a GPU (the default; the only choice on ARM64)
#   --torch cuda   PyTorch with NVIDIA CUDA 12.4 (x86-64 only; about 3 GB more to download)
#   --data-dir     where models, the index and the settings live (default ~/.local/share/vblis)
#   --python       the Python to build the environment with (3.11 to 3.13; default python3)
#   --no-service   don't write the systemd user service
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$REPO/api"
VENV="$API/.venv"
TORCH="cpu"
PYTHON="python3"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/vblis"
SERVICE=1
TORCH_VERSION="2.6.0"

while [ $# -gt 0 ]; do
  case "$1" in
    --torch) TORCH="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --python) PYTHON="${2:-}"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

ARCH="$(uname -m)"
case "$TORCH" in
  cpu)
    # PyPI's ARM64 build is the CPU build; on x86-64 the CPU index avoids 3 GB of CUDA libraries
    if [ "$ARCH" = "x86_64" ]; then TORCH_INDEX="https://download.pytorch.org/whl/cpu"; else TORCH_INDEX=""; fi ;;
  cuda)
    [ "$ARCH" = "x86_64" ] || fail "CUDA builds of PyTorch exist for x86-64 only."
    TORCH_INDEX="https://download.pytorch.org/whl/cu124" ;;
  *) fail "--torch must be cpu or cuda" ;;
esac
DATA_DIR="$(mkdir -p "$DATA_DIR" && cd "$DATA_DIR" && pwd)"
chmod 700 "$DATA_DIR"

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
    fail "Python 3.11 to 3.13 with venv is needed. On Debian or Ubuntu: sudo apt install python3-venv python3-pip"
  fi
fi
PY="$VENV/bin/python"
"$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade >/dev/null 2>&1 \
  || fail "The environment has no pip. Remove $VENV and install python3-venv (or uv), then run this again."
echo "$("$PY" --version) on $ARCH"

say "PyTorch $TORCH_VERSION ($TORCH)"
if [ -n "$TORCH_INDEX" ]; then
  "$PY" -m pip install --disable-pip-version-check "torch==$TORCH_VERSION" --index-url "$TORCH_INDEX"
else
  "$PY" -m pip install --disable-pip-version-check "torch==$TORCH_VERSION"
fi

say "The other packages"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# requirements.txt points pip at the Windows CUDA index, and constraints.txt pins the Windows build
# of torch and some Windows-only packages; leave those out here
grep -v '^--' "$API/requirements.txt" > "$WORK/requirements.txt"
grep -vE '^(torch|torchvision|pywin32-ctypes|pefile|pyinstaller|pyinstaller-hooks-contrib|altgraph)==' \
  "$API/constraints.txt" > "$WORK/constraints.txt"
"$PY" -m pip install --disable-pip-version-check -r "$WORK/requirements.txt" -c "$WORK/constraints.txt"
"$PY" -m pip check

say "Web interface"
if [ -f "$REPO/app/dist/index.html" ]; then
  echo "Found $REPO/app/dist"
elif command -v npm >/dev/null 2>&1; then
  (cd "$REPO/app" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build)
else
  echo "Not found, and Node.js isn't installed. Build it on any machine with Node.js 22:"
  echo "  cd app && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build"
  echo "then copy app/dist here, to $REPO/app/dist. The server runs without it but shows only a note."
fi

say "Check"
"$PY" -c 'import torch, chromadb, transformers, PIL, pillow_heif, av, cv2, cryptography; print("torch", torch.__version__, "- CUDA available:", torch.cuda.is_available())'

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

cat <<EOF

Installed. Next steps:
  1. Set the owner password (and a viewer password if you want one):
       ${RUN[*]} set-password owner
       ${RUN[*]} set-password viewer
  2. Allow the folders browsers may index:
       ${RUN[*]} add-library-folder /path/to/photos
  3. Optional: HTTPS with a self-signed certificate, or see SERVER.md for other choices:
       ${RUN[*]} set tls self_signed
  4. Start it:
       ${RUN[*]} serve
     or as a service:
       systemctl --user daemon-reload && systemctl --user enable --now vblis
       sudo loginctl enable-linger $USER    # keeps it running after you log out
  5. Open http://<this machine's address>:8080 and sign in. Download a model in Settings.
EOF
