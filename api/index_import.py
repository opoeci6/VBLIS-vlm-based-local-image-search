"""Import an index that another VBLIS exported (index_export) into this data folder, as a read-only replica.

Every stored path is rewritten with a path map (for example D:\\Photos=/mnt/photos), so this machine ends up
with an ordinary local index: record ids, video frame ids, media registry keys and the folder list are made
with this machine's own rules, exactly as its indexer would have made them. Nothing at runtime has to know
that the index came from elsewhere, except that data/replica.json marks the folder read-only (replica.py).

The export file may come from anywhere, so it is checked as it is read: a known format version and model,
member names from a fixed list (no name from the file is ever used as a file name here), size limits, no
pickles, scalar metadata only, and mapped paths that stay inside the folders the map names.

Order of work: everything is read and checked first (the media details are staged in memory, the records go
into a collection under a temporary name, the thumbnails are added to the cache). Then the marker is written:
that is the commit point. A failure before it leaves the previous index and settings as they were (the
temporary collection is removed; extra cache files are harmless). After it the old collection is swapped
out and the media details, the folder list and the model setting are replaced; a failure there leaves a
folder that is already marked read-only, and running the same import again completes it."""
import datetime
import hashlib
import io
import json
import ntpath
import os
import posixpath
import re
import tempfile
import time
import zipfile
from typing import NamedTuple, Optional

import numpy as np

import path_keys
from index_export import collection_name_for
from model_list import AVAILABLE_MODELS

FORMAT = "vblis-index-export"
FORMAT_VERSION = 1
REPLICA_FILE = "replica.json"
TEMP_SUFFIX = "_import"

_CHUNK_MEMBER = re.compile(r"records/(\d{4})\.(npy|jsonl)")
_IMAGE_THUMB = re.compile(r"thumbnails/images/([0-9a-f]{64})_thumb\.jpg")
_VIDEO_THUMB = re.compile(r"thumbnails/videos/([0-9a-f]{64})_(\d+)\.jpg")
_VIDEO_ID = re.compile(r"video:([0-9a-f]{64}):(\d+)")
_FIXED_MEMBERS = {"manifest.json", "folders.json", "registry.jsonl"}
# Size limits (uncompressed): far above what a real library needs, far below what would exhaust memory
_MAX_JSON_MEMBER = 64 * 2**20      # manifest.json, folders.json
_MAX_ARRAY_MEMBER = 512 * 2**20    # one records/NNNN.npy (the exporter writes 2,000 rows: about 9 MB)
_MAX_LINES_MEMBER = 2 * 2**30      # one JSON-lines member, read line by line
_MAX_LINE = 1 * 2**20              # one record's or registry row's JSON
_MAX_THUMB = 16 * 2**20
_REGISTRY_COLUMNS = (
    "path", "media_type", "ext", "size", "mtime_ns", "width", "height", "orientation", "rotation",
    "duration_s", "taken_at", "taken_offset", "taken_source", "gps_lat", "gps_lon", "gps_alt",
    "probe_version", "error", "probed_at",
)
_SCALARS = (str, int, float, bool)


class ImportProblem(Exception):
    """An export that can't be imported, or a path map that doesn't fit it. `code` is for tests and scripts."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class ImportResult(NamedTuple):
    collection: str
    model_id: str
    records: int
    images: int
    video_frames: int
    dropped: int             # records under a root the map doesn't cover (or with a path that can't be used)
    duplicates: int          # records that landed on a path already imported
    missing: int             # imported records whose file isn't on this machine (yet)
    missing_examples: tuple
    registry_rows: int
    image_thumbnails: int
    video_thumbnails: int
    unmapped_roots: tuple
    model_present: bool
    seconds: float


# ---------------------------------------------------------------- path map

def source_flavor(manifest):
    """The path module of the machine that made the export (its stored paths follow its rules)."""
    return ntpath if (manifest.get("source") or {}).get("path_flavor") == "windows" else posixpath


def parse_map(specs, flavor, host=os.path):
    """[(from_root, to_root)] from "FROM=TO" strings: FROM in the exporting machine's form, TO a folder here.
    Longest FROM first, so a nested root wins over its parent."""
    maps = []
    for spec in specs or ():
        if spec.count("=") != 1:
            raise ImportProblem("bad_map", f"--map needs FROM=TO with one '=': {spec!r}")
        source, target = (part.strip() for part in spec.split("="))
        if not source or not target:
            raise ImportProblem("bad_map", f"--map needs both sides: {spec!r}")
        if "\0" in source or "\0" in target:
            raise ImportProblem("bad_map", f"--map has a NUL character: {spec!r}")
        source = flavor.normpath(source)
        if not flavor.isabs(source):
            raise ImportProblem("bad_map", f"{source!r} is not an absolute path on the exporting machine")
        if not host.isabs(target):
            raise ImportProblem("bad_map", f"{target!r} is not an absolute path on this machine")
        maps.append((source, host.abspath(host.normpath(target))))
    if not maps:
        raise ImportProblem("bad_map", "give at least one --map FROM=TO")
    maps.sort(key=lambda pair: len(pair[0]), reverse=True)
    return maps


def _components(path, flavor):
    """(drive, [names]) of a normalised absolute path: ("D:", ["Photos", "a.jpg"]), ("", ["mnt", "x"])."""
    drive, tail = flavor.splitdrive(flavor.normpath(path))
    return drive, [part for part in tail.split(flavor.sep) if part]


def _usable_name(part, host):
    """A file or folder name that means the same, single name on this machine. A name from the other machine
    can hold what is a separator, a drive or a stream here (a POSIX name may contain \\ or C:), so those are
    refused rather than joined."""
    if not part or part in (".", "..") or "\0" in part:
        return False
    if host.sep in part or (host.altsep and host.altsep in part):
        return False
    if host is ntpath and (":" in part or part.endswith((" ", "."))):
        return False  # a drive, an alternate data stream, or a name Windows silently changes
    return True


def _inside(path, folder, host):
    path, folder = host.normcase(host.normpath(path)), host.normcase(host.normpath(folder))
    return path == folder or path.startswith(folder.rstrip(host.sep) + host.sep)


def map_path(stored, maps, flavor, host=os.path):
    """The local path of a stored path, or None when no root of the map covers it or the names below the root
    can't be used here. Roots are compared name by name; a Windows source ignores case there (as Windows did,
    with str.lower like path_keys). The names below the root keep their case, and the result always lies in
    the folder the map names."""
    if not isinstance(stored, str) or "\0" in stored:
        return None
    fold = str.lower if flavor is ntpath else (lambda s: s)
    drive, parts = _components(stored, flavor)
    for source, target in maps:
        source_drive, source_parts = _components(source, flavor)
        if fold(drive) != fold(source_drive) or len(parts) < len(source_parts):
            continue
        if all(fold(a) == fold(b) for a, b in zip(parts, source_parts)):
            rest = parts[len(source_parts):]
            if not all(_usable_name(part, host) for part in rest):
                return None
            local = host.join(target, *rest) if rest else target
            return local if _inside(local, target, host) else None
    return None


def video_source_key(path):
    """indexer._video_source_key, without importing the indexer (it loads the model stack)."""
    normalized = os.path.abspath(os.path.normpath(path))
    return hashlib.sha256(path_keys.fold(normalized).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- reading the export

class _Export:
    """The checked contents of an export file. Only names from the fixed list are ever opened."""

    def __init__(self, path):
        try:
            self.zip = zipfile.ZipFile(path)
        except (OSError, zipfile.BadZipFile) as e:
            raise ImportProblem("not_an_export", f"{path} is not a VBLIS export: {e}") from None
        try:
            self._check(path)
        except BaseException:
            self.zip.close()
            raise

    def _check(self, path):
        self.chunks = {}
        self.image_thumbs = {}
        self.video_thumbs = {}
        for info in self.zip.infolist():
            name = info.filename
            if info.is_dir():
                continue
            if name in _FIXED_MEMBERS:
                continue
            match = _CHUNK_MEMBER.fullmatch(name)
            if match:
                self.chunks.setdefault(match.group(1), {})[match.group(2)] = info
                continue
            match = _IMAGE_THUMB.fullmatch(name)
            if match:
                self.image_thumbs[match.group(1)] = info
                continue
            match = _VIDEO_THUMB.fullmatch(name)
            if match:
                self.video_thumbs[(match.group(1), int(match.group(2)))] = info
                continue
            raise ImportProblem("unexpected_member", f"the export holds an unexpected file: {name!r}")
        if "manifest.json" not in self.zip.namelist():
            raise ImportProblem("not_an_export", f"{path} has no manifest.json")
        self.manifest = self.json("manifest.json")
        if not isinstance(self.manifest, dict) or self.manifest.get("format") != FORMAT:
            raise ImportProblem("not_an_export", f"{path} is not a VBLIS export")
        version = self.manifest.get("format_version")
        if version != FORMAT_VERSION:
            raise ImportProblem("unsupported_version",
                                f"the export has format version {version}; this VBLIS reads version {FORMAT_VERSION}")
        for key, kinds in self.chunks.items():
            if set(kinds) != {"npy", "jsonl"}:
                raise ImportProblem("broken_export", f"record chunk {key} is incomplete")
        model_id = self.manifest.get("model_id")
        if model_id not in AVAILABLE_MODELS:
            raise ImportProblem("unknown_model", f"the export is for a model this VBLIS doesn't offer: {model_id!r}")
        if self.manifest.get("collection") != collection_name_for(model_id):
            raise ImportProblem("broken_export", "the manifest's collection doesn't belong to its model")

    def close(self):
        self.zip.close()

    def _read(self, info_or_name, limit, what):
        info = info_or_name if isinstance(info_or_name, zipfile.ZipInfo) else self.zip.getinfo(info_or_name)
        if info.file_size > limit:
            raise ImportProblem("broken_export", f"{info.filename} is too large for {what}")
        try:
            return self.zip.read(info)
        except (zipfile.BadZipFile, OSError, EOFError) as e:  # a damaged member (CRC, truncated file)
            raise ImportProblem("broken_export", f"{info.filename} can't be read: {e}") from None

    def json(self, name):
        try:
            return json.loads(self._read(name, _MAX_JSON_MEMBER, "a settings file").decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            raise ImportProblem("broken_export", f"{name} is not valid JSON: {e}") from None

    def lines(self, info_or_name):
        """The JSON objects of a JSON-lines member, one at a time; no line longer than _MAX_LINE is read."""
        info = info_or_name if isinstance(info_or_name, zipfile.ZipInfo) else self.zip.getinfo(info_or_name)
        if info.file_size > _MAX_LINES_MEMBER:
            raise ImportProblem("broken_export", f"{info.filename} is too large")
        try:
            with self.zip.open(info) as raw:
                number = 0
                while True:
                    line = raw.readline(_MAX_LINE + 1)
                    if not line:
                        return
                    number += 1
                    if len(line) > _MAX_LINE:
                        raise ImportProblem("broken_export", f"line {number} of {info.filename} is too long")
                    if line.strip():
                        value = json.loads(line.decode("utf-8"))
                        if not isinstance(value, dict):
                            raise ImportProblem("broken_export", f"line {number} of {info.filename} is not an object")
                        yield value
        except (UnicodeDecodeError, ValueError) as e:
            raise ImportProblem("broken_export", f"{info.filename} is not valid JSON lines: {e}") from None
        except (zipfile.BadZipFile, OSError, EOFError) as e:
            raise ImportProblem("broken_export", f"{info.filename} can't be read: {e}") from None

    def array(self, info):
        data = self._read(info, _MAX_ARRAY_MEMBER, "a record chunk")
        try:
            array = np.load(io.BytesIO(data), allow_pickle=False)
        except (ValueError, OSError, EOFError) as e:
            raise ImportProblem("broken_export", f"{info.filename} is not a plain array: {e}") from None
        if not isinstance(array, np.ndarray) or array.ndim != 2 or array.dtype != np.float32:
            raise ImportProblem("broken_export", f"{info.filename} is not a float32 matrix")
        if not np.isfinite(array).all():
            raise ImportProblem("broken_export", f"{info.filename} holds values that are not numbers")
        return array

    def thumb(self, info):
        if info.file_size > _MAX_THUMB:
            return None
        return self._read(info, _MAX_THUMB, "a thumbnail")


# ---------------------------------------------------------------- writing

def _write_atomic(path, data: bytes):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".import.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _model_present(models_dir, model_id):
    folder = os.path.join(models_dir, "hub", "models--" + model_id.replace("/", "--"))
    return os.path.isdir(os.path.join(folder, "snapshots"))


def read_replica(data_dir) -> Optional[dict]:
    """The replica marker of a data folder, or None when the folder holds an ordinary index."""
    path = os.path.join(data_dir, REPLICA_FILE)
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        # A damaged marker still marks the folder: better read-only by mistake than writable by mistake
        return {"source": {}, "damaged": True}
    return value if isinstance(value, dict) else {"source": {}, "damaged": True}


def _count(client, name):
    try:
        return client.get_collection(name).count()
    except Exception:
        return 0


def import_index(export_path, map_specs, *, chroma_dir, data_dir, cache_dir, models_dir, env_file,
                 force=False, progress=print, host=os.path) -> ImportResult:
    """Import `export_path` into this data folder (see the module docstring). The caller holds the
    data-folder lock (no server may run on this folder meanwhile). A folder that holds an index made here
    (not an earlier import) is refused unless `force`: the import would replace it."""
    import chromadb

    started = time.monotonic()
    export = _Export(export_path)
    try:
        manifest = export.manifest
        flavor = source_flavor(manifest)
        maps = parse_map(map_specs, flavor, host)
        collection_name = manifest["collection"]
        roots = [r for r in manifest.get("roots") or [] if isinstance(r, str)]
        unmapped_roots = tuple(r for r in roots if map_path(r, maps, flavor, host) is None)
        if roots and len(unmapped_roots) == len(roots):
            raise ImportProblem("map_covers_nothing",
                                "no root of the export is covered by the map; the export's roots are: "
                                + ", ".join(roots))

        # Read and check everything before anything is changed
        registry_rows, rotations = _read_registry(export, maps, flavor, host)
        progress(f"Media details: {len(registry_rows):,} files checked")

        client = chromadb.PersistentClient(path=str(chroma_dir))
        temp_name = collection_name[:63 - len(TEMP_SUFFIX)] + TEMP_SUFFIX
        if not force and read_replica(str(data_dir)) is None:
            own = sorted(name for name in (getattr(c, "name", c) for c in client.list_collections())
                         if name != temp_name and _count(client, name) > 0)
            if own:
                raise ImportProblem("own_index",
                                    "This data folder already holds an index made here (" + ", ".join(own)
                                    + "). Import into an empty folder (--data-dir), or add --force to replace "
                                    "that index and make this folder a read-only copy.")
        try:
            client.delete_collection(temp_name)  # a leftover of an import that stopped half-way
        except Exception:
            pass
        temp = client.create_collection(name=temp_name, metadata={"hnsw:space": "cosine"})
        try:
            records = _import_records(export, temp, max(1, min(5000, client.get_max_batch_size())),
                                      maps, flavor, host, progress)
            image_thumbs, video_thumbs = _import_thumbnails(export, records, rotations, cache_dir)
            progress(f"Thumbnails: {image_thumbs:,} pictures, {video_thumbs:,} video frames")
            # The commit point: from here on the folder is a read-only copy, complete or not
            _write_marker(manifest, maps, flavor, records, data_dir)
        except BaseException:
            try:
                client.delete_collection(temp_name)
            except Exception:
                pass
            raise

        try:
            try:
                client.delete_collection(collection_name)
            except Exception:
                pass
            temp.modify(name=collection_name)
            written = _replace_registry(registry_rows, data_dir)
            _write_settings(manifest, maps, flavor, host, roots, data_dir, env_file)
        except BaseException as e:
            raise ImportProblem(
                "incomplete",
                f"The import stopped after the new index was put in place ({type(e).__name__}: {e}). This data "
                "folder is marked as a read-only copy; run the same import again to finish it.") from e
        progress(f"Media details: {written:,} files")
        return ImportResult(
            collection=collection_name, model_id=manifest["model_id"], records=records.imported,
            images=records.images, video_frames=records.video_frames, dropped=records.dropped,
            duplicates=records.duplicates, missing=records.missing,
            missing_examples=tuple(records.missing_examples), registry_rows=written,
            image_thumbnails=image_thumbs, video_thumbnails=video_thumbs, unmapped_roots=unmapped_roots,
            model_present=_model_present(models_dir, manifest["model_id"]),
            seconds=round(time.monotonic() - started, 1),
        )
    finally:
        export.close()


class _Records:
    """What the record pass found, for the later passes and the report."""

    def __init__(self):
        self.imported = self.images = self.video_frames = 0
        self.dropped = self.duplicates = self.missing = 0
        self.missing_examples = []
        self.present = {}        # new path -> exists on this machine
        self.frames = {}         # (old video sha, ms) -> (new path, timestamp seconds)
        self.image_hashes = set()  # content hashes of the imported pictures (their thumbnails are wanted)


def _clean_metadata(meta):
    """The metadata Chroma accepts: scalar values only (anything else came from a damaged or crafted file)."""
    return {key: value for key, value in meta.items()
            if isinstance(key, str) and isinstance(value, _SCALARS) and not (isinstance(value, float) and value != value)}


def _import_records(export, temp, batch, maps, flavor, host, progress) -> _Records:
    """Adds the mapped records of every chunk to the temporary collection, with this machine's ids."""
    found = _Records()
    seen_ids = set()
    dimensions = None
    chunk_keys = sorted(export.chunks)
    for index, key in enumerate(chunk_keys, 1):
        embeddings = export.array(export.chunks[key]["npy"])
        rows = list(export.lines(export.chunks[key]["jsonl"]))
        if len(rows) != len(embeddings):
            raise ImportProblem("broken_export", f"record chunk {key} has {len(rows)} records and "
                                                 f"{len(embeddings)} embeddings")
        if dimensions is None:
            dimensions = embeddings.shape[1]
        elif embeddings.shape[1] != dimensions:
            raise ImportProblem("broken_export", f"record chunk {key} has embeddings of another size")
        ids, metas, vectors = [], [], []
        for row, vector in zip(rows, embeddings):
            old_id, meta = row.get("id"), row.get("metadata")
            if not isinstance(old_id, str) or not isinstance(meta, dict) or not isinstance(meta.get("path"), str):
                raise ImportProblem("broken_export", f"record chunk {key} has a record without an id or path")
            new_path = map_path(meta["path"], maps, flavor, host)
            if new_path is None:
                found.dropped += 1
                continue
            video = None
            if meta.get("media_type") == "video":
                video = _VIDEO_ID.fullmatch(old_id)
                if not video:
                    raise ImportProblem("broken_export", f"a video frame has an unexpected id: {old_id!r}")
                new_id = f"video:{video_source_key(new_path)}:{video.group(2)}"
            else:
                new_id = new_path
            if new_id in seen_ids:
                found.duplicates += 1
                continue
            seen_ids.add(new_id)
            meta = dict(_clean_metadata(meta), path=new_path)
            stat = None
            if host is os.path:
                try:
                    stat = os.stat(new_path)
                except (OSError, ValueError):
                    stat = None
            # A picture copied without its file time keeps its size: take this machine's time, so the
            # thumbnail cache finds its content hash without reading the file (Indexer.content_hash)
            if not video and stat is not None and meta.get("size") == stat.st_size:
                meta["mtime_ns"] = stat.st_mtime_ns
            ids.append(new_id)
            metas.append(meta)
            vectors.append(vector)
            found.imported += 1
            if video:
                found.video_frames += 1
                timestamp = meta.get("timestamp_seconds")
                found.frames[(video.group(1), int(video.group(2)))] = (
                    new_path, float(timestamp) if isinstance(timestamp, (int, float)) else 0.0)
            else:
                found.images += 1
                if isinstance(meta.get("hash"), str):
                    found.image_hashes.add(meta["hash"])
            if new_path not in found.present:
                found.present[new_path] = stat is not None if host is os.path else host.isfile(new_path)
                if not found.present[new_path]:
                    found.missing += 1
                    if len(found.missing_examples) < 5:
                        found.missing_examples.append(new_path)
        for start in range(0, len(ids), batch):
            temp.add(ids=ids[start:start + batch], metadatas=metas[start:start + batch],
                     embeddings=np.asarray(vectors[start:start + batch], dtype=np.float32))
        progress(f"Records: chunk {index} of {len(chunk_keys)} ({found.imported:,} imported)")
    return found


def _read_registry(export, maps, flavor, host):
    """The media details to write, checked and mapped, before anything changes. Returns (rows, {local path
    key: rotation} of the videos)."""
    from media_registry import ACCESS_ERROR_PREFIX, MediaRegistry

    rows, rotations = [], {}
    if "registry.jsonl" not in export.zip.namelist():
        return rows, rotations
    for row in export.lines("registry.jsonl"):
        new_path = map_path(row.get("path"), maps, flavor, host)
        if new_path is None:
            continue
        clean = {column: row.get(column) for column in _REGISTRY_COLUMNS}
        clean["path"] = new_path
        if any(value is not None and not isinstance(value, _SCALARS) for value in clean.values()):
            continue
        if (not isinstance(clean["size"], int) or not isinstance(clean["mtime_ns"], int)
                or not isinstance(clean["media_type"], str) or not isinstance(clean["ext"], str)):
            continue
        if not isinstance(clean.get("probe_version"), int):
            clean["probe_version"] = 0
        # The other computer could not open that file (its permissions or a lock there): this one reads it again
        if isinstance(clean.get("error"), str) and clean["error"].startswith(ACCESS_ERROR_PREFIX):
            clean["probe_version"] = 0
        if not isinstance(clean.get("rotation"), (int, type(None))):
            clean["rotation"] = None
        # A copy made without keeping file times: the same size counts as the same file, so the registry does
        # not send every file to be read again
        if host is os.path:
            try:
                st = os.stat(new_path)
                if st.st_size == clean["size"]:
                    clean["mtime_ns"] = st.st_mtime_ns
            except (OSError, ValueError):
                pass
        rows.append(clean)
        if clean["media_type"] == "video":
            rotations[MediaRegistry.key_for(new_path)] = int(clean.get("rotation") or 0)
    return rows, rotations


def _replace_registry(rows, data_dir) -> int:
    """This folder's media registry becomes the imported files' rows."""
    from media_registry import MediaRegistry

    registry = MediaRegistry(os.path.join(data_dir, "media_registry.sqlite3"))
    try:
        registry.delete(list(registry.stat_index()))
        return registry.upsert(rows)
    finally:
        registry.close()


def _import_thumbnails(export, records, rotations, cache_dir):
    """Picture thumbnails are keyed by content and copied as they are (only the imported pictures'); a video
    frame's key holds its path and file stat, so it is written under the key this machine computes."""
    from media_registry import MediaRegistry
    from media_video import get_video_frame_cache_path

    image_thumbs = video_thumbs = 0
    images_dir = os.path.join(cache_dir, "images")
    videos_dir = os.path.join(cache_dir, "videos")
    for file_hash, info in export.image_thumbs.items():
        if file_hash not in records.image_hashes:
            continue  # a picture the map left out
        target = os.path.join(images_dir, f"{file_hash}_thumb.jpg")
        if os.path.exists(target):
            continue
        data = export.thumb(info)
        if data:
            _write_atomic(target, data)
            image_thumbs += 1
    for (sha, ms), info in export.video_thumbs.items():
        frame = records.frames.get((sha, ms))
        if frame is None or not records.present.get(frame[0]):
            continue
        new_path, timestamp = frame
        try:
            st = os.stat(new_path)
        except (OSError, ValueError):
            continue
        rotation = rotations.get(MediaRegistry.key_for(new_path), 0)
        target = str(get_video_frame_cache_path(new_path, timestamp, cache_dir=videos_dir, stat=st,
                                                rotation=rotation))
        if os.path.exists(target):
            continue
        data = export.thumb(info)
        if data:
            _write_atomic(target, data)
            video_thumbs += 1
    return image_thumbs, video_thumbs


def _write_marker(manifest, maps, flavor, records, data_dir):
    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    marker = {
        "format": 1,
        "source": {"host": str(source.get("host") or "")[:255], "os": str(source.get("os") or "")[:32],
                   "path_flavor": "windows" if flavor is ntpath else "posix"},
        "exported_at": manifest.get("created_at") if isinstance(manifest.get("created_at"), str) else None,
        "imported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "model_id": manifest["model_id"],
        "collection": manifest["collection"],
        "map": [list(pair) for pair in maps],
        "counts": {"records": records.imported, "images": records.images, "video_frames": records.video_frames,
                   "dropped": records.dropped, "missing": records.missing},
    }
    _write_atomic(os.path.join(data_dir, REPLICA_FILE),
                  json.dumps(marker, ensure_ascii=False, indent=2).encode("utf-8"))


def _write_settings(manifest, maps, flavor, host, roots, data_dir, env_file):
    """The folder list (this collection's mapped roots only) and the active model."""
    import settings_store

    # Written directly: FolderRegistry keeps a replica's folder list in memory (it never saves on a replica)
    mapped_roots = sorted({mapped for mapped in (map_path(r, maps, flavor, host) for r in roots) if mapped})
    _write_atomic(os.path.join(data_dir, "indexed_folders.json"),
                  json.dumps({manifest["collection"]: mapped_roots}, ensure_ascii=False, indent=2).encode("utf-8"))
    settings_store.update_env({"ACTIVE_MODEL": manifest["model_id"]}, env_path=str(env_file))


def detach_replica(data_dir) -> bool:
    """Turns a replica folder into an ordinary index (indexing allowed again). True when it was a replica."""
    try:
        os.remove(os.path.join(data_dir, REPLICA_FILE))
        return True
    except FileNotFoundError:
        return False
