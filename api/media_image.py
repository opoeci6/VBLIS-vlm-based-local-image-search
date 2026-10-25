import hashlib
import os
import struct
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif"}

# Bump when the image preprocessing before embedding changes. Image records without "embed_version"
# (or with a lower one) are version 1 and get re-checked by reindex.
IMAGE_EMBED_VERSION = 2

# EXIF orientation tag ID
_EXIF_ORIENTATION_TAG = 0x0112

# Maps EXIF orientation value -> (PIL transpose methods to apply in order)
_ORIENTATION_TRANSFORMS = {
    2: [Image.FLIP_LEFT_RIGHT],
    3: [Image.ROTATE_180],
    4: [Image.FLIP_TOP_BOTTOM],
    5: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_90],
    6: [Image.ROTATE_270],
    7: [Image.FLIP_LEFT_RIGHT, Image.ROTATE_270],
    8: [Image.ROTATE_90],
}

def _parse_exif_orientation(exif_bytes: bytes) -> int:
    """Parse the EXIF orientation tag directly from raw EXIF bytes (TIFF structure).
    Returns the orientation value (1-8), or 1 (no rotation) if not found."""
    try:
        # Strip optional 'Exif\x00\x00' header to get to the TIFF data
        tiff = exif_bytes[6:] if exif_bytes.startswith(b"Exif\x00\x00") else exif_bytes
        if len(tiff) < 8:
            return 1
        # Determine byte order
        byte_order = tiff[:2]
        if byte_order == b"II":
            endian = "<"   # little-endian
        elif byte_order == b"MM":
            endian = ">"   # big-endian
        else:
            return 1
        # Read offset to first IFD
        ifd_offset = struct.unpack(endian + "I", tiff[4:8])[0]
        if ifd_offset + 2 > len(tiff):
            return 1
        num_entries = struct.unpack(endian + "H", tiff[ifd_offset:ifd_offset + 2])[0]
        for i in range(num_entries):
            entry_offset = ifd_offset + 2 + i * 12
            if entry_offset + 12 > len(tiff):
                break
            tag = struct.unpack(endian + "H", tiff[entry_offset:entry_offset + 2])[0]
            if tag == _EXIF_ORIENTATION_TAG:
                value = struct.unpack(endian + "H", tiff[entry_offset + 8:entry_offset + 10])[0]
                return value
    except Exception:
        pass
    return 1

def _apply_exif_orientation(img: Image.Image, exif_bytes: bytes) -> Image.Image:
    """Rotate/flip a PIL image to correct orientation based on raw EXIF bytes."""
    orientation = _parse_exif_orientation(exif_bytes)
    transforms = _ORIENTATION_TRANSFORMS.get(orientation, [])
    for t in transforms:
        img = img.transpose(t)
    return img

def _decode_heif_with_orientation(source):
    """Decode a HEIC/HEIF path or file object. Returns (upright PIL image, EXIF orientation value)."""
    heif_file = pillow_heif.open_heif(source)
    img = Image.frombytes(
        heif_file.mode,
        heif_file.size,
        heif_file.data,
        "raw",
    )
    orientation = 1
    exif_bytes = heif_file.info.get("exif", b"")
    if exif_bytes:
        orientation = _parse_exif_orientation(exif_bytes)
        img = _apply_exif_orientation(img, exif_bytes)
    return img, orientation

def decode_heif(path) -> Image.Image:
    """Decode a HEIC/HEIF file to a PIL image, applying its EXIF orientation."""
    return _decode_heif_with_orientation(path)[0]

def _is_heif_source(source) -> bool:
    if isinstance(source, (str, os.PathLike)):
        return os.path.splitext(os.fspath(source))[1].lower() in (".heic", ".heif")
    try:
        source.seek(0)
        return pillow_heif.is_supported(source)
    finally:
        source.seek(0)

def open_image_upright(source):
    """Open an image (path or binary file object) with its EXIF orientation applied and pixels loaded.
    Returns (image, rotated); rotated is True when the orientation needed a rotation or flip."""
    if _is_heif_source(source):
        img, orientation = _decode_heif_with_orientation(source)
        return img, orientation in _ORIENTATION_TRANSFORMS
    img = Image.open(source)
    try:
        if img.getexif().get(_EXIF_ORIENTATION_TAG, 1) in _ORIENTATION_TRANSFORMS:
            upright = ImageOps.exif_transpose(img)
            img.close()
            return upright, True
        img.load()
        return img, False
    except Exception:
        img.close()
        raise

def compute_file_hash(filepath, chunk_size=8192):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()

def process_file_worker(filepath):
    """Worker function for multithreaded CPU preprocessing pool.
    Calculates SHA-256 hash and pre-loads the upright PIL image in parallel.
    Returns (filepath, hash, image, error, rotated); rotated is True when EXIF orientation was applied.
    """
    try:
        file_hash = compute_file_hash(filepath)
        img, rotated = open_image_upright(filepath)  # Decodes into CPU memory in the thread pool
        return (filepath, file_hash, img, None, rotated)
    except Exception as e:
        return (filepath, None, None, str(e), False)
