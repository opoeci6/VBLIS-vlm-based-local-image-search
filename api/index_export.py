"""Export of one collection (one model's index) into a single portable file, so another machine can import
it and search it read-only. The file is a ZIP container:

    manifest.json              format, version, source machine, model, dimensions, counts, roots (written last)
    records/0000.npy           float32 embeddings of one chunk of records, shape (k, dimensions)
    records/0000.jsonl         the same k records, same order: {"id": ..., "metadata": {...}}
    registry.jsonl             media registry rows (every column but `key`) of the exported records' files
    folders.json               {"roots": [...]} the indexed folders of the collection
    thumbnails/images/<hash>_thumb.jpg      image thumbnails, named like the image cache's files
    thumbnails/videos/<sha>_<ms>.jpg        video frame thumbnails, named by the record id (video:<sha>:<ms>)

Records go out in chunks so a library of any size never sits in memory. Nothing is written under the data
folder: the file is built next to its target as <target>.partial and moved into place when it is complete."""
import json
import os
import re
import socket
import time
import zipfile
from datetime import datetime, timezone
from typing import Callable, NamedTuple, Optional

import numpy as np

FORMAT = "vblis-index-export"
FORMAT_VERSION = 1
EXTENSION = ".vblis-export"
DEFAULT_CHUNK_SIZE = 2000  # records per Chroma read and per .npy member (2000 x 1152 floats is 9 MB)
THUMBNAIL_PROGRESS_STEP = 500
DEFAULT_MODEL = "google/siglip2-base-patch16-224"  # what app_state loads when ACTIVE_MODEL is not set

_IMAGE_HASH = re.compile(r"^[0-9a-f]{64}$")
_VIDEO_ID = re.compile(r"^video:([0-9a-f]{64}):(\d+)$")


class ExportError(Exception):
    """The export can't be made. `code` is one of invalid_path, unknown_model, no_index, failed."""

    def __init__(self, message: str, code: str = "failed"):
        super().__init__(message)
        self.code = code


class ExportCancelled(Exception):
    """should_stop() answered True; the partial file is gone."""


class ExportResult(NamedTuple):
    path: str
    records: int
    images: int
    video_frames: int
    registry_rows: int
    image_thumbnails: int
    video_thumbnails: int
    bytes: int
    seconds: float


def collection_name_for(model_id: str) -> str:
    """The Chroma collection of a model (ModelManager.get_collection_name uses this too)."""
    return model_id.replace("/", "_").replace("-", "_")


def resolve_output_path(raw) -> str:
    """The final path of the export file: absolute, with EXTENSION, not an existing directory, in an existing
    directory. Raises ExportError(code="invalid_path")."""
    if not isinstance(raw, str) or not raw.strip() or "\0" in raw:
        raise ExportError("Give the full path of the file to write.", "invalid_path")
    path = os.path.normpath(raw.strip())
    if not os.path.isabs(path) or (os.name == "nt" and not os.path.splitdrive(path)[0]):
        raise ExportError("Give the full path of the file to write.", "invalid_path")
    if os.path.isdir(path):
        raise ExportError(f"{path} is a folder; give a file name.", "invalid_path")
    if not path.lower().endswith(EXTENSION):
        path += EXTENSION
        if os.path.isdir(path):
            raise ExportError(f"{path} is a folder; give another file name.", "invalid_path")
    if not os.path.isdir(os.path.dirname(path)):
        raise ExportError(f"The folder {os.path.dirname(path)} doesn't exist.", "invalid_path")
    return path


def registry_rotation_for(registry) -> Callable[[str], int]:
    """A rotation_for(path) that reads the display rotation of a video from its media registry row, which
    counts only when its size and mtime are those of the file now (else 0, as Indexer.video_rotation does
    for a file it can't probe)."""
    def rotation_for(path: str) -> int:
        try:
            stat = os.stat(path)
        except OSError:
            return 0
        for row in registry.rows([registry.key_for(path)]):
            if (row["media_type"] == "video" and row["rotation"] is not None
                    and row["size"] == stat.st_size and row["mtime_ns"] == stat.st_mtime_ns):
                return int(row["rotation"])
        return 0

    return rotation_for


def _member(name: str, compress_type: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=time.localtime()[:6])
    info.compress_type = compress_type
    info.external_attr = 0o644 << 16
    return info


def _write_json(zf: zipfile.ZipFile, name: str, data) -> None:
    zf.writestr(_member(name, zipfile.ZIP_DEFLATED), json.dumps(data, ensure_ascii=False).encode("utf-8"))


def _write_jsonl(zf: zipfile.ZipFile, name: str, items) -> None:
    lines = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items)
    zf.writestr(_member(name, zipfile.ZIP_DEFLATED), lines.encode("utf-8"))


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _write_archive(zf, client, collection_name, model_id, registry, folders, image_cache_dir, video_cache_dir,
                   thumbnails, rotation_for, progress, should_stop, chunk_size) -> dict:
    """Fill the open archive; returns the counts for the manifest."""
    def report(done, total, label):
        if progress is not None:
            progress(done, total, label)

    def check_stop():
        if should_stop is not None and should_stop():
            raise ExportCancelled()

    try:
        collection = client.get_collection(name=collection_name)
    except Exception as e:  # noqa: BLE001  (Chroma raises different errors by version)
        raise ExportError(f"There is no index for {model_id}.", "no_index") from e
    ids = list(collection.get(include=[])["ids"])
    if not ids:
        raise ExportError(f"The index for {model_id} is empty.", "no_index")
    total = len(ids)

    dimensions = None
    records = images = chunks = 0
    image_hashes = set()
    video_frames = []  # (record id, source path, timestamp in seconds)
    registry_keys = set()
    for start in range(0, total, chunk_size):
        check_stop()
        got = collection.get(ids=ids[start:start + chunk_size], include=["embeddings", "metadatas"])
        embeddings = got.get("embeddings")
        metadatas = got.get("metadatas")
        rows = []
        vectors = []
        for index, record_id in enumerate(got["ids"]):
            vector = None if embeddings is None else embeddings[index]
            if vector is None or len(vector) == 0:
                continue  # an id that vanished or has no embedding
            vector = np.asarray(vector, dtype=np.float32)
            if dimensions is None:
                dimensions = int(vector.shape[0])
            if vector.shape != (dimensions,):
                raise ExportError(f"Record {record_id} has {vector.shape[0]} dimensions, not {dimensions}.")
            metadata = dict((metadatas[index] if metadatas is not None else None) or {})
            rows.append({"id": record_id, "metadata": metadata})
            vectors.append(vector)
            path = metadata.get("path")
            if isinstance(path, str) and path:
                registry_keys.add(registry.key_for(path))
            if metadata.get("media_type") == "video":
                video_frames.append((record_id, path, metadata.get("timestamp_seconds")))
            else:
                images += 1
                if isinstance(metadata.get("hash"), str):
                    image_hashes.add(metadata["hash"])
        if rows:
            stem = f"records/{chunks:04d}"
            with zf.open(_member(stem + ".npy", zipfile.ZIP_STORED), "w", force_zip64=True) as member:
                np.save(member, np.stack(vectors), allow_pickle=False)
            _write_jsonl(zf, stem + ".jsonl", rows)
            chunks += 1
            records += len(rows)
        report(min(start + chunk_size, total), 2 * total if thumbnails else total, "Reading the index")
    if records == 0:
        raise ExportError(f"The index for {model_id} has no embeddings.", "no_index")

    check_stop()
    registry_rows = [{column: value for column, value in row.items() if column != "key"}
                     for row in registry.rows(registry_keys)]
    _write_jsonl(zf, "registry.jsonl", registry_rows)
    roots = sorted(folders.selected(collection_name))
    _write_json(zf, "folders.json", {"roots": roots})

    image_thumbnails = video_thumbnails = 0
    if thumbnails:
        from media_video import get_video_frame_cache_path

        # The reading above is the first half of the progress, the thumbnails the second (their number is
        # only known now), so the bar never moves back
        wanted = sorted(h for h in image_hashes if _IMAGE_HASH.match(h))
        steps = max(1, len(wanted) + len(video_frames))
        step = 0

        def advance():
            nonlocal step
            step += 1
            if step % THUMBNAIL_PROGRESS_STEP == 0:
                check_stop()
                report(total + total * step // steps, 2 * total, "Copying thumbnails")

        for file_hash in wanted:
            advance()
            source = os.path.join(os.fspath(image_cache_dir), f"{file_hash}_thumb.jpg")
            if os.path.isfile(source):
                zf.write(source, f"thumbnails/images/{file_hash}_thumb.jpg", compress_type=zipfile.ZIP_STORED)
                image_thumbnails += 1
        local_videos = {}  # source path -> (stat, rotation), or None when the video isn't on this machine
        for record_id, path, timestamp in video_frames:
            advance()
            match = _VIDEO_ID.match(record_id)
            if match is None or not isinstance(path, str) or not isinstance(timestamp, (int, float)):
                continue
            if path not in local_videos:
                try:
                    stat = os.stat(path)
                    rotation = int(rotation_for(path)) if rotation_for else 0
                    local_videos[path] = (stat, rotation)
                except Exception:  # noqa: BLE001  (the video is gone, or its rotation can't be read)
                    local_videos[path] = None
            known = local_videos[path]
            if known is None:
                continue
            source = get_video_frame_cache_path(
                path, timestamp, cache_dir=video_cache_dir, stat=known[0], rotation=known[1])
            if os.path.isfile(source):
                zf.write(source, f"thumbnails/videos/{match.group(1)}_{match.group(2)}.jpg",
                         compress_type=zipfile.ZIP_STORED)
                video_thumbnails += 1
        report(2 * total, 2 * total, "Copying thumbnails")

    counts = {
        "records": records, "images": images, "video_frames": len(video_frames),
        "registry_rows": len(registry_rows), "image_thumbnails": image_thumbnails,
        "video_thumbnails": video_thumbnails, "chunks": chunks,
    }
    _write_json(zf, "manifest.json", {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "os": os.name,
            "path_flavor": "windows" if os.name == "nt" else "posix",
            "host": socket.gethostname(),
        },
        "model_id": model_id,
        "collection": collection_name,
        "dimensions": dimensions,
        "counts": counts,
        "roots": roots,
    })
    return counts


def export_index(client, collection_name, model_id, registry, folders, image_cache_dir, video_cache_dir, out_path, *,
                 thumbnails=True, rotation_for=None, progress=None, should_stop=None,
                 chunk_size=DEFAULT_CHUNK_SIZE) -> ExportResult:
    """Write the collection to out_path (replacing a file there). progress(done, total, label) is called after
    each chunk and now and then while thumbnails are copied; should_stop() is checked between chunks and
    raises ExportCancelled when it answers True. On any failure the partial file is deleted and the target
    is left as it was. rotation_for(path) gives a video's display rotation for its thumbnail cache key."""
    started = time.monotonic()
    out_path = os.fspath(out_path)
    partial = out_path + ".partial"
    try:
        with zipfile.ZipFile(partial, "w", allowZip64=True) as zf:
            counts = _write_archive(zf, client, collection_name, model_id, registry, folders, image_cache_dir,
                                    video_cache_dir, thumbnails, rotation_for, progress, should_stop,
                                    max(1, int(chunk_size)))
        os.replace(partial, out_path)
    except BaseException:
        _remove_quietly(partial)
        raise
    return ExportResult(
        path=out_path, records=counts["records"], images=counts["images"], video_frames=counts["video_frames"],
        registry_rows=counts["registry_rows"], image_thumbnails=counts["image_thumbnails"],
        video_thumbnails=counts["video_thumbnails"], bytes=os.path.getsize(out_path),
        seconds=round(time.monotonic() - started, 1),
    )


def human_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 ** 2:
        return f"{size / 1024:.0f} KB"
    if size < 1024 ** 3:
        return f"{size / 1024 ** 2:.0f} MB"
    return f"{size / 1024 ** 3:.1f} GB"


def summary(result: ExportResult) -> str:
    return f"Exported {result.records:,} items to {os.path.basename(result.path)} ({human_size(result.bytes)})"


def run_export_task(indexer, task) -> None:
    """The EXPORT_INDEX task: payload {"output_path", "model_id", "thumbnails"}. A cancel ends it quietly (the
    queue marks the task cancelled); any other problem is an error on the task."""
    import paths

    payload = task.payload or {}
    state = {"done": 0, "total": 0}

    def progress(done, total, label):
        state["done"], state["total"] = done, total
        task.update_progress(done, total, label)

    def should_stop():
        return not task.check_paused_or_cancelled() or bool(getattr(indexer, "cancel_requested", False))

    try:
        out_path = resolve_output_path(payload.get("output_path"))
        model_id = payload.get("model_id")
        if not isinstance(model_id, str) or not model_id:
            raise ExportError("No model was given.", "unknown_model")
        result = export_index(
            indexer.client, collection_name_for(model_id), model_id, indexer.media_registry, indexer.folders,
            paths.IMAGE_CACHE_DIR, indexer.video_cache_dir, out_path,
            thumbnails=bool(payload.get("thumbnails", True)), rotation_for=indexer.video_rotation,
            progress=progress, should_stop=should_stop,
        )
    except ExportCancelled:
        return
    except Exception as e:  # noqa: BLE001
        task.add_error(str(e) or type(e).__name__)
        # A task that made progress before failing would end as completed; with nothing processed it fails
        task.update_progress(0, state["total"] or 1)
        return
    task.update_progress(max(state["total"], 1), max(state["total"], 1), summary(result))
