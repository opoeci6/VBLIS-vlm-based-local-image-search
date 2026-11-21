#!/usr/bin/env bash
# Install the Python packages of the VBLIS server into an existing virtual environment.
# Shared by scripts/install-linux.sh and deploy/Dockerfile. See SERVER.md.
#
#   scripts/linux-deps.sh --python PY [--torch cpu|cuda] [--api DIR]
#
#   --python   the Python of an existing virtual environment (it needs pip)
#   --torch    cpu: PyTorch without a GPU (the default; the only choice on ARM64)
#              cuda: PyTorch with NVIDIA CUDA 13.0 (x86-64 only; GTX 16 / RTX 20 or newer and NVIDIA
#                    driver 580 or newer; a few GB more to download)
#   --api      the folder with requirements.txt and constraints.txt (default: ../api next to this script)
#
# Installs PyTorch first, then the other packages, then runs "pip check".
# With PIP_NO_CACHE_DIR set, pip keeps no download cache (the Docker image does that).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="$HERE/../api"
PY=""
TORCH="cpu"
TORCH_VERSION="2.14.1"

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --python) PY="${2:-}"; shift 2 ;;
    --torch) TORCH="${2:-}"; shift 2 ;;
    --api) API="${2:-}"; shift 2 ;;
    -h|--help) sed -n "2,13p" "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

[ -n "$PY" ] || fail "--python is required (the Python of a virtual environment)."
[ -x "$PY" ] || fail "$PY is not an executable Python."
[ -f "$API/requirements.txt" ] && [ -f "$API/constraints.txt" ] \
  || fail "requirements.txt and constraints.txt were not found in $API"

ARCH="$(uname -m)"
case "$TORCH" in
  cpu)
    # The CPU index on both architectures: PyPI's Linux builds pull in the CUDA 13 libraries (several GB),
    # on ARM64 too
    TORCH_INDEX="https://download.pytorch.org/whl/cpu" ;;
  cuda)
    [ "$ARCH" = "x86_64" ] || fail "CUDA builds of PyTorch exist for x86-64 only."
    TORCH_INDEX="https://download.pytorch.org/whl/cu130" ;;
  *) fail "--torch must be cpu or cuda" ;;
esac

PIP=("$PY" -m pip)
PIP_ARGS=(--disable-pip-version-check)
if [ -n "${PIP_NO_CACHE_DIR:-}" ]; then PIP_ARGS+=(--no-cache-dir); fi

say "PyTorch $TORCH_VERSION ($TORCH)"
if [ -n "$TORCH_INDEX" ]; then
  "${PIP[@]}" install "${PIP_ARGS[@]}" "torch==$TORCH_VERSION" --index-url "$TORCH_INDEX"
else
  "${PIP[@]}" install "${PIP_ARGS[@]}" "torch==$TORCH_VERSION"
fi

say "The other packages"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# requirements.txt points pip at the Windows CUDA index, and constraints.txt pins the Windows build
# of torch and some Windows-only packages; leave those out here
grep -v '^--' "$API/requirements.txt" > "$WORK/requirements.txt"
grep -vE '^(torch|torchvision|pywin32-ctypes|pefile|pyinstaller|pyinstaller-hooks-contrib|altgraph)==' \
  "$API/constraints.txt" > "$WORK/constraints.txt"
"${PIP[@]}" install "${PIP_ARGS[@]}" -r "$WORK/requirements.txt" -c "$WORK/constraints.txt"
"${PIP[@]}" check
