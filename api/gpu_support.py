"""Whether this machine's NVIDIA GPU can run the PyTorch build VBLIS ships with.

A PyTorch build only carries GPU code for some generations: the CUDA 13.0 build covers Turing (GTX 16,
RTX 20) and newer, so a GTX 10-series card reports CUDA as available and then fails on its first operation
("no kernel image is available"). A driver older than the build's CUDA version makes CUDA unavailable with
only a warning. check_cuda() tells these cases apart, so the model manager can use the CPU instead and
Settings can say why.

The check reads the card's compute capability against torch.cuda.get_arch_list() and, when asked to probe,
runs one tiny operation on the card. The probe creates a CUDA context (a few hundred MB of VRAM), so it only
runs when the GPU is actually wanted."""
import re
import threading
import warnings
from typing import NamedTuple, Optional, Sequence, Tuple

import torch

DRIVER_TOO_OLD = "driver_too_old"    # an NVIDIA driver older than the CUDA version of this build
UNSUPPORTED_GPU = "unsupported_gpu"  # a card this build has no code for (GTX 10-series and older)
CUDA_FAILED = "cuda_failed"          # anything else that stops CUDA from starting

_DETAIL_LIMIT = 300
_ARCH = re.compile(r"(sm|compute)_(\d+)(\d)([a-z]?)")


class CudaCheck(NamedTuple):
    usable: bool
    code: Optional[str]        # None when usable, and when there is no NVIDIA GPU or no CUDA build at all
    gpu_name: Optional[str]
    capability: Optional[str]  # "sm_86"
    detail: Optional[str]      # the first line of the warning or error, for the log
    probed: bool               # whether one operation ran on the card


def supports(capability: Tuple[int, int], arch_list: Sequence[str]) -> bool:
    """True when code in `arch_list` (as torch.cuda.get_arch_list() gives it) runs on a card of `capability`.

    Machine code for sm_XY runs on the same major version with a minor of Y or more (sm_86 code runs on an
    sm_89 card), except arch-specific code (sm_90a), which runs only on exactly that version. PTX
    (compute_XY) is compiled by the driver for any card of XY or newer."""
    major, minor = capability
    for arch in arch_list:
        match = _ARCH.fullmatch(arch)
        if not match:
            continue
        kind, arch_major, arch_minor, suffix = match.group(1), int(match.group(2)), int(match.group(3)), match.group(4)
        if kind == "compute":
            if (arch_major, arch_minor) <= (major, minor):
                return True
        elif suffix:
            if (arch_major, arch_minor) == (major, minor):
                return True
        elif arch_major == major and arch_minor <= minor:
            return True
    return False


def _first_line(text) -> str:
    lines = str(text).strip().splitlines()
    return (lines[0] if lines else "")[:_DETAIL_LIMIT]


def _is_driver_problem(text: str) -> bool:
    text = text.lower()
    return "driver" in text and ("too old" in text or "insufficient" in text)


def driver_cuda_version() -> Optional[int]:
    """The newest CUDA version the installed NVIDIA driver supports (12080 = 12.8), read straight from the
    driver library; None when there is no NVIDIA driver. Needs no CUDA initialisation, so it also works where
    torch only warned once (the warning may have gone to an earlier caller)."""
    import ctypes
    import sys
    names = ("nvcuda.dll",) if sys.platform == "win32" else ("libcuda.so.1", "libcuda.so")
    for name in names:
        try:
            library = ctypes.CDLL(name)
            version = ctypes.c_int(0)
            if library.cuDriverGetVersion(ctypes.byref(version)) == 0 and version.value > 0:
                return version.value
        except (OSError, AttributeError):
            continue
    return None


def _build_cuda_major() -> Optional[int]:
    """The CUDA major version this torch was built with (13 for cu130), None for a CPU build."""
    try:
        return int(str(torch.version.cuda).split(".")[0]) if torch.version.cuda else None
    except ValueError:
        return None


def _run_check(probe: bool) -> CudaCheck:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            available = torch.cuda.is_available()
            failure = None
        except Exception as e:  # is_available is documented not to raise; a broken install still might
            available, failure = False, e
    if not available:
        build_major = _build_cuda_major()
        driver = driver_cuda_version() if build_major else None
        # A driver of the same CUDA major version runs every minor version of the build
        if build_major and driver is not None and driver // 1000 < build_major:
            detail = (f"the NVIDIA driver supports CUDA {driver // 1000}.{driver % 1000 // 10}; "
                      f"this PyTorch build needs CUDA {torch.version.cuda}")
            return CudaCheck(False, DRIVER_TOO_OLD, None, None, detail, False)
        messages = [str(w.message) for w in caught] + ([str(failure)] if failure else [])
        for message in messages:
            if _is_driver_problem(message):
                return CudaCheck(False, DRIVER_TOO_OLD, None, None, _first_line(message), False)
        if failure is not None:
            return CudaCheck(False, CUDA_FAILED, None, None, _first_line(failure), False)
        return CudaCheck(False, None, None, None, None, False)  # no NVIDIA GPU, or a CPU build

    try:
        name = torch.cuda.get_device_name(0)
        major, minor = torch.cuda.get_device_capability(0)
    except Exception as e:
        code = DRIVER_TOO_OLD if _is_driver_problem(str(e)) else CUDA_FAILED
        return CudaCheck(False, code, None, None, _first_line(e), False)
    capability = f"sm_{major}{minor}"
    arch_list = list(torch.cuda.get_arch_list() or [])
    if arch_list and not supports((major, minor), arch_list):
        detail = f"{name} is {capability}; this PyTorch build has code for {', '.join(arch_list)}"
        return CudaCheck(False, UNSUPPORTED_GPU, name, capability, detail[:_DETAIL_LIMIT], False)
    if not probe:
        return CudaCheck(True, None, name, capability, None, False)

    try:
        values = torch.ones(8, device="cuda") * 2
        torch.cuda.synchronize()
        total = float(values.sum().item())
        del values
        if total != 16.0:
            raise RuntimeError(f"a test operation on the GPU returned {total} instead of 16")
    except Exception as e:
        text = str(e)
        if "no kernel image" in text.lower():
            code = UNSUPPORTED_GPU
        elif _is_driver_problem(text):
            code = DRIVER_TOO_OLD
        else:
            code = CUDA_FAILED
        return CudaCheck(False, code, name, capability, _first_line(e), True)
    return CudaCheck(True, None, name, capability, None, True)


_lock = threading.Lock()
_results = {}  # probe flag -> CudaCheck; a probed result also answers an unprobed question


def check_cuda(probe: bool = False) -> CudaCheck:
    """The cached CudaCheck of this process. probe=True also runs one operation on the card (once)."""
    with _lock:
        result = _results.get(True) or (None if probe else _results.get(False))
        if result is None:
            result = _run_check(probe)
            _results[probe] = result
            if result.code:
                print(f"[GPU] Not using the GPU ({result.code}): {result.detail}")
        return result


def reset_cache():
    """Forgets the cached checks (tests)."""
    with _lock:
        _results.clear()
