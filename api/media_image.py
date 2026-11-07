import hashlib
import math
import os
import re
import struct
from datetime import datetime
from PIL import Image, ImageOps, UnidentifiedImageError
import pillow_heif

pillow_heif.register_heif_opener()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif", ".avif"}


# macOS leaves metadata next to real files when it writes to a non-Apple drive or into a zip: "._<name>"
# AppleDouble files, and "__MACOSX" folders that unzipped archives carry. They keep the media extension of the
# file they describe but are not media, so file discovery, the folder views and the media registry skip them.
def is_macos_junk_dir(name: str) -> bool:
    return name.lower() == "__macosx"


def is_macos_junk_file(name: str) -> bool:
    return name.startswith("._")


def is_macos_junk_path(path: str) -> bool:
    """True for an AppleDouble file or any file inside a __MACOSX folder."""
    parts = re.split(r"[\\/]+", path)
    return is_macos_junk_file(parts[-1]) or any(is_macos_junk_dir(part) for part in parts[:-1])

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

def _rotates(orientation: int) -> bool:
    """True when this EXIF orientation value needs a rotation or flip."""
    return orientation in _ORIENTATION_TRANSFORMS

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

def _ftyp_brands(head: bytes) -> set:
    """The major and compatible brands of the ftyp box that starts an ISO BMFF file (HEIF, AVIF)."""
    if head[4:8] != b"ftyp":
        return set()
    size = min(int.from_bytes(head[:4], "big"), len(head))
    return {head[8:12]} | {head[i:i + 4] for i in range(16, size - 3, 4)}

_AVIF_BRANDS = {b"avif", b"avis"}

def _read_head(source, size=64) -> bytes:
    """The first bytes of a binary file object, which is left at its start."""
    try:
        source.seek(0)
        return source.read(size)
    finally:
        source.seek(0)

def _is_heif_source(source) -> bool:
    """True for HEIC/HEIF, which pillow_heif decodes. AVIF uses the same container, but this pillow_heif has no
    AV1 decoder, so AVIF goes to Pillow's own AVIF plugin."""
    if isinstance(source, (str, os.PathLike)):
        return os.path.splitext(os.fspath(source))[1].lower() in (".heic", ".heif")
    head = _read_head(source)
    brands = _ftyp_brands(head)  # empty unless the data starts with an ftyp box
    return (bool(brands) and pillow_heif.get_file_mimetype(head).startswith("image/hei")
            and not brands & _AVIF_BRANDS)

def _is_avif_source(source) -> bool:
    if isinstance(source, (str, os.PathLike)):
        return os.path.splitext(os.fspath(source))[1].lower() == ".avif"
    return bool(_ftyp_brands(_read_head(source)) & _AVIF_BRANDS)

def _open_with_pillow(source):
    """Image.open, with an AVIF tried by Pillow's AVIF plugin first. pillow_heif's HEIF opener is registered at
    startup, so ahead of that plugin, and it also claims AVIFs whose major brand is the generic "mif1", which
    it then can't decode."""
    if _is_avif_source(source):
        try:
            return Image.open(source, formats=["AVIF"])
        except UnidentifiedImageError:
            pass  # not an AVIF after all (a misnamed file): every plugin gets a try
    return Image.open(source)

def open_image_upright(source):
    """Open an image (path or binary file object) with its EXIF orientation applied and pixels loaded.
    Returns (image, rotated); rotated is True when the orientation needed a rotation or flip."""
    if _is_heif_source(source):
        img, orientation = _decode_heif_with_orientation(source)
        return img, _rotates(orientation)
    img = _open_with_pillow(source)
    try:
        if _rotates(img.getexif().get(_EXIF_ORIENTATION_TAG, 1)):
            upright = ImageOps.exif_transpose(img)
            img.close()
            return upright, True
        img.load()
        return img, False
    except Exception:
        img.close()
        raise

def read_orientation(path) -> int:
    """EXIF orientation value (1-8) of an image file, read from its header without decoding any pixels."""
    if _is_heif_source(path):
        heif_file = pillow_heif.open_heif(path)  # .data would decode, so only .info is touched
        return _parse_exif_orientation(heif_file.info.get("exif", b"") or b"")
    with _open_with_pillow(path) as img:
        return img.getexif().get(_EXIF_ORIENTATION_TAG, 1)

# Header-only metadata probing. The date and GPS helpers are shared with media_video.
_DATETIME_RE = re.compile(
    r"(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?", re.I)
_OFFSET_RE = re.compile(r"Z|[+-]\d{2}(?::?\d{2})?", re.I)
_MIN_YEAR = 1800

def _text(value):
    """A str or bytes metadata value (possibly NUL padded) as stripped text, or None for other types."""
    if isinstance(value, bytes):
        value = value.decode("ascii", "ignore")
    return value.strip("\x00 \t\r\n") if isinstance(value, str) else None

def _normalize_offset(value):
    """'+HH:MM' / '-HH:MM' from '+08:00', '+0800', '+08' or 'Z'; None when missing or invalid."""
    text = _text(value)
    if not text or not _OFFSET_RE.fullmatch(text):
        return None
    if text.upper() == "Z":
        return "+00:00"
    digits = text[1:].replace(":", "")
    hours, minutes = int(digits[:2]), int(digits[2:4] or 0)
    return f"{text[0]}{hours:02d}:{minutes:02d}" if hours <= 14 and minutes <= 59 else None

def _parse_datetime(value):
    """(naive datetime, embedded offset or None) from 'YYYY:MM:DD HH:MM:SS' style text; fractional seconds
    are dropped. None when blank, zero, unparsable, an invalid calendar date or an implausible year."""
    text = _text(value)
    match = _DATETIME_RE.fullmatch(text) if text else None
    if not match:
        return None
    try:
        moment = datetime(*(int(part) for part in match.groups()[:6]))
    except ValueError:
        return None
    if not _MIN_YEAR <= moment.year <= datetime.now().year + 1:
        return None
    return moment, _normalize_offset(match.group(7))

def _format_taken(moment) -> str:
    return moment.isoformat(timespec="seconds")

def _format_offset(delta) -> str:
    minutes = int(delta.total_seconds() // 60)
    return f"{'-' if minutes < 0 else '+'}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"

def _finite(value):
    """float(value), or None when it is not a finite number (zero-denominator rationals included)."""
    try:
        number = float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return number if math.isfinite(number) else None

def _check_gps(lat, lon, alt):
    """(lat, lon, alt) with junk dropped: lat/lon survive only as an in-range pair that is not the (0, 0)
    no-fix value, and the altitude only with them."""
    if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180 or (lat == 0 and lon == 0):
        return None, None, None
    return lat, lon, alt

def _gps_coordinate(gps, dms_tag, ref_tag, positive, negative):
    ref = (_text(gps.get(ref_tag)) or "").upper()[:1]
    if ref not in (positive, negative):
        return None
    try:
        degrees, minutes, seconds = (_finite(part) for part in gps.get(dms_tag))
    except (TypeError, ValueError):
        return None
    if None in (degrees, minutes, seconds):
        return None
    value = degrees + minutes / 60 + seconds / 3600
    return -value if ref == negative else value

def _exif_gps(gps):
    """(lat, lon, alt) from an EXIF GPS IFD."""
    lat = _gps_coordinate(gps, 2, 1, "N", "S")
    lon = _gps_coordinate(gps, 4, 3, "E", "W")
    alt = _finite(gps.get(6))
    if alt is not None:
        ref = gps.get(5)
        if isinstance(ref, bytes):
            ref = ref.strip(b"\x00")
        alt = -alt if ref in (1, b"\x01", b"1", "1") else alt
    return _check_gps(lat, lon, alt)

def _exif_ifd(exif, tag):
    try:
        return exif.get_ifd(tag)
    except Exception:
        return {}

def _read_exif(exif_bytes) -> dict:
    """Orientation, date taken and GPS from raw EXIF bytes; unreadable or missing EXIF gives the defaults."""
    exif = Image.Exif()
    try:
        if exif_bytes:
            exif.load(exif_bytes)
    except Exception:
        exif = Image.Exif()
    orientation = exif.get(_EXIF_ORIENTATION_TAG)
    if not isinstance(orientation, int) or not 1 <= orientation <= 8:
        orientation = 1
    sub = _exif_ifd(exif, 0x8769)
    taken_at = taken_offset = None
    for value, offset in ((sub.get(0x9003), sub.get(0x9011)),
                          (sub.get(0x9004), sub.get(0x9012)),
                          (exif.get(0x0132), sub.get(0x9010))):
        parsed = _parse_datetime(value)
        if parsed:
            taken_at, taken_offset = _format_taken(parsed[0]), _normalize_offset(offset) or parsed[1]
            break
    lat, lon, alt = _exif_gps(_exif_ifd(exif, 0x8825))
    return {"orientation": orientation, "taken_at": taken_at, "taken_offset": taken_offset,
            "gps_lat": lat, "gps_lon": lon, "gps_alt": alt}

def probe_image_info(path) -> dict:
    """Size, EXIF orientation, date taken and GPS of an image file, read from its header without decoding
    any pixels. width/height are the upright size (swapped for orientations 5-8, as open_image_upright
    rotates). Raises when the file cannot be opened as an image."""
    if _is_heif_source(path):
        heif_file = pillow_heif.open_heif(path)  # .data would decode, so only .size and .info are touched
        (width, height), exif_bytes = heif_file.size, heif_file.info.get("exif") or b""
    else:
        with _open_with_pillow(path) as img:
            (width, height), exif_bytes = img.size, img.info.get("exif") or b""
    info = _read_exif(exif_bytes)
    if info["orientation"] in (5, 6, 7, 8):
        width, height = height, width
    return {"width": width, "height": height, **info}

def compute_file_hash(filepath):
    with open(filepath, 'rb') as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

def read_rotated(path) -> bool:
    """True when the file's EXIF orientation needs a rotation or flip (read as read_orientation does)."""
    return _rotates(read_orientation(path))

def inspect_file(filepath, orientation=True):
    """Worker function for the multithreaded CPU pool: hashes a file and, when asked, reads its EXIF
    orientation from the header. That decodes no pixels, except that Pillow loads a PNG whose EXIF comes
    after its image data, so callers only ask when the orientation decides something.
    Returns (filepath, hash, rotated, error); rotated is True when the orientation needs a rotation or flip,
    None when it was not read.
    """
    try:
        file_hash = compute_file_hash(filepath)
        return (filepath, file_hash, read_rotated(filepath) if orientation else None, None)
    except Exception as e:
        return (filepath, None, False, str(e))
