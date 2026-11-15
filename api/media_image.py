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

# Bump when the image preprocessing before embedding changes. Image records without "embed_version" are
# version 1. What each version changed, and so which older records a reindex has to look at again:
#   2: the EXIF orientation is applied before embedding (every format).
#   3: a HEIC / HEIF file that carries its rotation in the container (irot / imir) no longer gets its EXIF
#      orientation applied on top. Only HEIC / HEIF records can be wrong, see embed_version_is_current.
IMAGE_EMBED_VERSION = 3

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

_HEIF_TRANSFORM_BOXES = (b"irot", b"imir")
_HEIF_BOX_LIMIT = 4096  # boxes looked at per level: far more than a real file has, and it bounds a broken one

def _iso_boxes(stream, start, end):
    """(type, payload start, payload end) of the ISO BMFF boxes between two file offsets."""
    position = start
    for _ in range(_HEIF_BOX_LIMIT):
        if position + 8 > end:
            return
        stream.seek(position)
        header = stream.read(8)
        if len(header) < 8:
            return
        size, payload = int.from_bytes(header[:4], "big"), position + 8
        if size == 1:  # a 64-bit size follows the type
            size, payload = int.from_bytes(stream.read(8), "big"), position + 16
        elif size == 0:  # the box runs to the end
            size = end - position
        if size < payload - position or position + size > end:
            return
        yield header[4:8], payload, position + size
        position += size

def _stream_has_heif_transform(stream) -> bool:
    stream.seek(0, os.SEEK_END)
    end = stream.tell()
    for box, start, stop in _iso_boxes(stream, 0, end):
        if box != b"meta":
            continue
        # meta is a full box: 4 bytes of version and flags come before its children
        for child, child_start, child_stop in _iso_boxes(stream, start + 4, stop):
            if child != b"iprp":
                continue
            for group, group_start, group_stop in _iso_boxes(stream, child_start, child_stop):
                if group != b"ipco":
                    continue
                for prop, prop_start, prop_stop in list(_iso_boxes(stream, group_start, group_stop)):
                    if prop == b"imir":
                        return True
                    if prop == b"irot" and prop_stop > prop_start:
                        stream.seek(prop_start)
                        if stream.read(1)[0] & 3:  # the low two bits count quarter turns; 0 turns nothing
                            return True
        return False
    return False

def _heif_has_transform(source) -> bool:
    """True when a HEIC/HEIF file (path or binary file object) declares a rotation or mirroring in its
    container (an irot item property that turns, or an imir one). libheif applies those while decoding, and such a file's EXIF
    orientation describes the same turn, so it must not be applied again. A camera app that writes the
    orientation to EXIF only has no such property. A file that can't be read this way counts as having none."""
    try:
        if isinstance(source, (str, os.PathLike)):
            with open(source, "rb") as stream:
                return _stream_has_heif_transform(stream)
        position = source.tell()
        try:
            return _stream_has_heif_transform(source)
        finally:
            source.seek(position)
    except Exception:
        return False

def _heif_orientations(heif_file, source):
    """(orientation to apply, EXIF orientation as written) of an opened HEIC/HEIF file: the EXIF value is
    not applied when the container already turned the picture."""
    written = _parse_exif_orientation(heif_file.info.get("exif", b"") or b"")
    if _rotates(written) and _heif_has_transform(source):
        return 1, written
    return written, written

def _decode_heif_with_orientation(source):
    """Decode a HEIC/HEIF path or file object. Returns (upright PIL image, orientation value that was
    applied on top of the decoder's own output)."""
    heif_file = pillow_heif.open_heif(source)
    orientation, _ = _heif_orientations(heif_file, source)
    img = Image.frombytes(
        heif_file.mode,
        heif_file.size,
        heif_file.data,
        "raw",
    )
    for transform in _ORIENTATION_TRANSFORMS.get(orientation, []):
        img = img.transpose(transform)
    return img, orientation

def decode_heif(path) -> Image.Image:
    """Decode a HEIC/HEIF file to an upright PIL image."""
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
    """The orientation value (1-8) open_image_upright applies to an image file, read from its header without
    decoding any pixels: the EXIF orientation, or 1 for a HEIC/HEIF whose container already turns it."""
    if _is_heif_source(path):
        heif_file = pillow_heif.open_heif(path)  # .data would decode, so only .info is touched
        return _heif_orientations(heif_file, path)[0]
    with _open_with_pillow(path) as img:
        return img.getexif().get(_EXIF_ORIENTATION_TAG, 1)

def embed_version_is_current(path, embed_version) -> bool:
    """True when a record embedded under `embed_version` needs no second look. Version 3 only changed
    HEIC/HEIF files, so a version 2 record of any other format is as good as a current one."""
    if embed_version >= IMAGE_EMBED_VERSION:
        return True
    return embed_version == 2 and not _is_heif_source(path)

def embedding_is_outdated(path, embed_version) -> bool:
    """True when the picture embedded under `embed_version` was turned differently from how the file is
    decoded today, so the record needs a new embedding. Read from the header, no pixels decoded.
      version 1 applied no EXIF orientation: wrong when one is applied today.
      version 2 applied it to every file: wrong for a HEIC/HEIF whose container turns it too."""
    if embed_version < 2:
        return _rotates(read_orientation(path))
    if embed_version < 3 and _is_heif_source(path):
        heif_file = pillow_heif.open_heif(path)
        applied, written = _heif_orientations(heif_file, path)
        return applied != written
    return False

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
    applied = None
    if _is_heif_source(path):
        heif_file = pillow_heif.open_heif(path)  # .data would decode, so only .size and .info are touched
        (width, height), exif_bytes = heif_file.size, heif_file.info.get("exif") or b""
        applied = _heif_orientations(heif_file, path)[0]
    else:
        with _open_with_pillow(path) as img:
            (width, height), exif_bytes = img.size, img.info.get("exif") or b""
    info = _read_exif(exif_bytes)
    if applied is not None and applied != info["orientation"]:
        info["orientation"] = applied  # the container already turned it: the size is the upright one
    if info["orientation"] in (5, 6, 7, 8):
        width, height = height, width
    return {"width": width, "height": height, **info}

def compute_file_hash(filepath):
    with open(filepath, 'rb') as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

def read_rotated(path) -> bool:
    """True when the file's EXIF orientation needs a rotation or flip (read as read_orientation does)."""
    return _rotates(read_orientation(path))

def inspect_file(filepath, orientation=True, embed_version=1):
    """Worker function for the multithreaded CPU pool: hashes a file and, when asked, reads from its header
    whether a record embedded under `embed_version` shows the picture turned differently from today (see
    embedding_is_outdated; for version 1 that is: the file has an orientation to apply). That decodes no
    pixels, except that Pillow loads a PNG whose EXIF comes after its image data, so callers only ask when
    the answer decides something.
    Returns (filepath, hash, rotated, error); rotated is that answer, None when it was not read.
    """
    try:
        file_hash = compute_file_hash(filepath)
        if not orientation:
            return (filepath, file_hash, None, None)
        rotated = read_rotated(filepath) if embed_version < 2 else embedding_is_outdated(filepath, embed_version)
        return (filepath, file_hash, rotated, None)
    except Exception as e:
        return (filepath, None, False, str(e))
