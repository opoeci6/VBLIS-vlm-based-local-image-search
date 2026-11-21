"""The library-wide duplicate index behind the "Duplicates" search filter, the visual copies of the results and
the counts of the filter panel.

Two levels, each built from the active collection and keyed by (collection name, CachedCollection.version):
  * exact:  images that share a SHA-256 hash with another image file. Built from the cached metadata scan, so it
            is cheap and rebuilt whenever it is stale.
  * visual: images whose stored embeddings have a dot product of at least `threshold` with another image, a pair
            with the same non-empty hash excluded (that is an exact copy). Built with blocked matrix products
            over every image embedding of the library (seconds on tens of thousands of images), so the caller
            decides when it is worth building (see DuplicateIndex.ensure_visual).

The visual level is also kept on disk when the index has a store folder (one file per collection, with the
embeddings it was built from): after a start it is read back instead of built, and after the library changed only
the images that changed are compared again (see DuplicateIndex). An image counts as changed when its record id,
hash, size, modified time or embedding version changed.

Files that exist on disk are never recorded here: callers answer that at query time with their own
_FileExistenceCache. Videos never take part. A finished level is never changed, so readers need no lock; a
build only reads Chroma."""
import json
import os
import re
import threading
import uuid
from collections import namedtuple
from pathlib import Path

import numpy as np

BLOCK_ROWS = 2048  # rows of one E[s:e] @ E.T product: never the full N x N matrix
SAVE_FORMAT = 1
# More changed images than this share of the library and a full build is done instead of an update
MAX_CHANGED_SHARE = 0.3
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,200}$")

# One image file of a collection: normcased path, the id of its (first) record, the path as recorded, its hash
# ("" when none) and what decides whether its embedding may have changed
ImageEntry = namedtuple("ImageEntry", "key record_id path hash signature")


def _is_video(meta):
    # Image records written before video support have no media_type
    return meta.get("media_type", "image") == "video"


def _signature(record_id, meta):
    return (str(record_id), str(meta.get("hash") or ""), str(meta.get("size", "")), str(meta.get("mtime_ns", "")),
            str(meta.get("embed_version", "")))


def image_entries(scan):
    """The ImageEntry of every image file of a full `collection.get(include=["metadatas"])`, in scan order. A
    file is one entry however many records (spellings of its path) name it; the first one counts."""
    entries = []
    seen = set()
    for record_id, meta in zip(scan.get("ids") or [], scan.get("metadatas") or []):
        path = meta.get("path") if meta else None
        if not path or _is_video(meta):
            continue
        key = os.path.normcase(path)
        if key in seen:
            continue
        seen.add(key)
        entries.append(ImageEntry(key, record_id, path, meta.get("hash") or "", _signature(record_id, meta)))
    return entries


class ExactLevel:
    """Image files that have another image file with the same hash. Immutable once built."""

    def __init__(self, collection_name, version, path_by_key, hash_by_key, keys_by_hash):
        self.collection_name = collection_name
        self.version = version
        self.path_by_key = path_by_key    # normcased path -> path as recorded (for display and disk checks)
        self.hash_by_key = hash_by_key    # normcased path -> hash (only files that share their hash)
        self.keys_by_hash = keys_by_hash  # hash -> tuple of normcased paths (two or more)

    def has_existing_partner(self, key, isfile):
        """True when another file with the hash of `key` (a normcased path) exists; isfile(path) -> bool."""
        file_hash = self.hash_by_key.get(key)
        if file_hash is None:
            return False
        for other in self.keys_by_hash[file_hash]:
            if other != key and isfile(self.path_by_key[other]):
                return True
        return False

    def count_existing(self, isfile):
        """How many existing files have an existing exact copy."""
        total = 0
        for keys in self.keys_by_hash.values():
            existing = sum(1 for key in keys if isfile(self.path_by_key[key]))
            if existing >= 2:
                total += existing
        return total


class VisualLevel:
    """Image files that have a visually similar image. Immutable once built."""

    def __init__(self, collection_name, version, neighbors, path_by_key, token=None):
        self.collection_name = collection_name
        self.version = version
        self.neighbors = neighbors      # normcased path -> frozenset of normcased paths (symmetric)
        self.path_by_key = path_by_key  # normcased path -> path as recorded (only files that have a partner)
        self.token = token              # the save this level was written as or read from (None: never saved)

    def partners(self, key):
        return self.neighbors.get(key, frozenset())

    def has_existing_partner(self, key, isfile):
        for other in self.partners(key):
            if isfile(self.path_by_key[other]):
                return True
        return False

    def count_existing(self, isfile):
        """How many existing files have an existing visual partner."""
        memo = {}

        def exists(key):
            answer = memo.get(key)
            if answer is None:
                answer = memo[key] = bool(isfile(self.path_by_key[key]))
            return answer

        return sum(1 for key, others in self.neighbors.items() if exists(key) and any(exists(o) for o in others))


def build_exact_level(collection_name, version, scan):
    """The ExactLevel of a full `collection.get(include=["metadatas"])`. A file is one entry however many
    records (spellings of its path) name it; the first one counts."""
    path_by_key = {}
    hash_by_key = {}
    keys_by_hash = {}
    for meta in scan.get("metadatas") or []:
        path = meta.get("path") if meta else None
        file_hash = meta.get("hash") if meta else None
        if not path or not file_hash or _is_video(meta):
            continue
        key = os.path.normcase(path)
        if key in hash_by_key:
            continue
        hash_by_key[key] = file_hash
        path_by_key[key] = path
        keys_by_hash.setdefault(file_hash, []).append(key)
    shared = {h: tuple(keys) for h, keys in keys_by_hash.items() if len(keys) >= 2}
    kept = {key for keys in shared.values() for key in keys}
    return ExactLevel(
        collection_name, version,
        {key: path for key, path in path_by_key.items() if key in kept},
        {key: file_hash for key, file_hash in hash_by_key.items() if key in kept},
        shared,
    )


def _read_embeddings(collection, entries, chunk_size):
    """(the entries that have an embedding, their float32 matrix in that order); `chunk_size` ids per call."""
    kept = []
    chunks = []
    for start in range(0, len(entries), chunk_size):
        part = entries[start:start + chunk_size]
        fetched = collection.get(ids=[entry.record_id for entry in part], include=["embeddings"])
        embeddings = fetched.get("embeddings")
        if embeddings is None:
            continue
        by_id = dict(zip(fetched.get("ids") or [], embeddings))
        rows = [(entry, by_id[entry.record_id]) for entry in part if by_id.get(entry.record_id) is not None]
        if rows:
            kept.extend(entry for entry, _ in rows)
            chunks.append(np.asarray([embedding for _, embedding in rows], dtype=np.float32))
    if not chunks:
        return [], np.zeros((0, 0), dtype=np.float32)
    return kept, np.concatenate(chunks)


def _links(matrix, hashes, threshold, block_rows, first_row=0):
    """Pairs (a, b), a < b, of rows whose dot product is at least `threshold`, a pair with the same non-empty hash
    excluded; only pairs that involve a row from `first_row` on (the rows before it were compared already). The
    products are float32, `block_rows` rows at a time."""
    found = set()
    count = len(hashes)
    if count < 2 or first_row >= count:
        return found
    hash_codes = {}
    codes = np.empty(count, dtype=np.int64)
    for row, file_hash in enumerate(hashes):
        codes[row] = hash_codes.setdefault(file_hash, len(hash_codes)) if file_hash else -1
    cut = np.float32(threshold)
    transposed = matrix.T
    for start in range(first_row, count, block_rows):
        end = min(start + block_rows, count)
        rows, cols = np.nonzero((matrix[start:end] @ transposed) >= cut)
        rows = rows + start
        wanted = (rows != cols) & ~((codes[rows] == codes[cols]) & (codes[rows] >= 0))
        # Both directions count: a product at the threshold may round differently either way round
        for row, col in zip(rows[wanted].tolist(), cols[wanted].tolist()):
            found.add((row, col) if row < col else (col, row))
    return found


def _level_from(collection_name, version, entries, pairs, token=None):
    adjacency = {}  # row -> set of rows
    for row, col in pairs:
        adjacency.setdefault(row, set()).add(col)
        adjacency.setdefault(col, set()).add(row)
    keys = [entry.key for entry in entries]
    neighbors = {keys[row]: frozenset(keys[col] for col in cols) for row, cols in adjacency.items()}
    path_by_key = {keys[row]: entries[row].path for row in adjacency}
    return VisualLevel(collection_name, version, neighbors, path_by_key, token)


def _pair_array(pairs):
    return np.asarray(sorted(pairs), dtype=np.int32).reshape(-1, 2)


def build_visual_level(collection, collection_name, version, threshold, chunk_size, block_rows, token=None,
                       keep=None):
    """The VisualLevel of every image record of `collection`. Embeddings are used as stored (the head pass of a
    search does the same) and read `chunk_size` ids per Chroma call; the products are float32, `block_rows`
    rows at a time. `keep`, a dict, receives what a saved level needs ("entries", "pairs", "matrix");
    otherwise the embedding matrix is gone when this returns."""
    entries, matrix = _read_embeddings(collection, image_entries(collection.get(include=["metadatas"])), chunk_size)
    pairs = _links(matrix, [entry.hash for entry in entries], threshold, block_rows)
    if keep is not None:
        keep.update(entries=entries, pairs=_pair_array(pairs), matrix=matrix)
    return _level_from(collection_name, version, entries, pairs, token)


_Saved = namedtuple("_Saved", "token entries pairs path")


class DuplicateIndex:
    """The two levels of the active collection (see the module docstring). One per Indexer.

    Thread safety: searches run in a thread pool. Each level has a lock so that only one build of it runs at a
    time; a request that needs a level waits for the running build and reuses its result when that is still
    good enough. A finished level is published by one attribute assignment, so a reader that takes no lock sees
    a complete level or none. `reset` (a collection switch) invalidates builds that are running.

    With a `store_dir`, the visual level of each collection is also saved there (`<collection>.visual.npz`: the
    images it was built from, their pairs and their float32 embeddings), always under the visual lock, so a read
    and a write of the file never overlap in this process. A stale level is updated from the saved file (whose
    images, pairs and embeddings belong together), never from the level in memory; no file, or one that can't
    be read, means a full build."""

    def __init__(self, threshold, chunk_size, block_rows=BLOCK_ROWS, store_dir=None, log=print):
        self.threshold = threshold
        self.chunk_size = chunk_size
        self.block_rows = block_rows
        self.store_dir = Path(store_dir) if store_dir is not None else None
        self.log = log
        self.last_visual = None  # how the last visual level came about: "built", "loaded", "updated" (tests)
        self._exact = None
        self._visual = None
        self._exact_lock = threading.Lock()
        self._visual_lock = threading.Lock()
        self._state_lock = threading.Lock()  # guards publishing against reset
        self._generation = 0

    def reset(self):
        """Forgets both levels (the collection was switched, cleared or deleted); a build that started before
        the reset is not published. A saved level stays on disk (see `forget`)."""
        with self._state_lock:
            self._generation += 1
            self._exact = None
            self._visual = None

    def forget(self, collection_name):
        """Deletes the saved visual level of a collection that was cleared or deleted. Best effort: a file left
        behind (or written by a build that was running) no longer matches the collection and is never used."""
        path = self._store_path(collection_name)
        if path is None:
            return
        self._remove_leftovers(path)
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            self.log(f"[Duplicates] Could not delete the saved look-alike index of {collection_name}: {e}")

    @staticmethod
    def _remove_leftovers(path):
        """Deletes the temporary files of saves that never finished (the backend was killed while writing):
        each is as large as the saved embeddings. Collection names hold no glob characters (_SAFE_NAME)."""
        try:
            for leftover in path.parent.glob(f"{path.name}.*.tmp"):
                try:
                    leftover.unlink()
                except OSError:
                    pass
        except OSError:
            pass

    @staticmethod
    def _version_of(collection):
        # A collection without a version (not a CachedCollection) never matches a level: it is always stale
        return getattr(collection, "version", None)

    @classmethod
    def _is_fresh(cls, level, collection):
        version = cls._version_of(collection)
        return (level is not None and version is not None and level.collection_name == collection.name
                and level.version == version)

    def _publish(self, attribute, level, generation):
        with self._state_lock:
            if generation == self._generation:
                setattr(self, attribute, level)
                return True
            return False

    def exact_level(self, collection):
        """The exact level of `collection`, built (or rebuilt when stale) first if needed."""
        level = self._exact
        if self._is_fresh(level, collection):
            return level
        with self._exact_lock:
            level = self._exact
            if self._is_fresh(level, collection):
                return level
            generation = self._generation
            # The version is read before the scan, so a write in between only makes the level look stale
            version = self._version_of(collection)
            level = build_exact_level(collection.name, version, collection.get(include=["metadatas"]))
            self._publish("_exact", level, generation)
            return level

    def fresh_exact(self, collection):
        """The exact level of `collection` when it is current; None otherwise. Never builds."""
        level = self._exact
        return level if self._is_fresh(level, collection) else None

    def existing_visual(self, collection):
        """The visual level of `collection`, fresh or stale; None when there is none. Never builds."""
        level = self._visual
        if level is not None and level.collection_name == collection.name:
            return level
        return None

    def ensure_visual(self, collection, reuse_stale=False):
        """The visual level of `collection`: built (or read back from disk) first when there is none. A stale one
        is brought up to date (an update of the changed images when a saved level allows it, a full build
        otherwise) unless `reuse_stale` (the library is being indexed: it would be stale again after every
        batch); then a saved level is read back as it is."""
        level = self._visual
        if self._usable_visual(level, collection, reuse_stale):
            return level
        with self._visual_lock:
            level = self._visual
            if self._usable_visual(level, collection, reuse_stale):
                return level
            generation = self._generation
            # The version is read before the scan, so a write in between only makes the level look stale
            version = self._version_of(collection)
            level, to_save = self._make_visual(collection, version, reuse_stale)
            if self._publish("_visual", level, generation) and to_save is not None:
                self._save(collection.name, level.token, **to_save)
            return level

    def refresh_visual(self, collection):
        """Brings the visual level of `collection` up to date when there is one, in memory or saved on disk (the
        background warm-up after a start or after indexing). Never builds a first one. True when the level is
        current afterwards, False when there is none."""
        if self.existing_visual(collection) is None:
            path = self._store_path(collection.name)
            if path is None or not path.is_file():
                return False
        self.ensure_visual(collection)
        return True

    @classmethod
    def _usable_visual(cls, level, collection, reuse_stale):
        if level is None or level.collection_name != collection.name:
            return False
        return reuse_stale or cls._is_fresh(level, collection)

    # --- making a visual level ------------------------------------------------------------------------------

    def _make_visual(self, collection, version, reuse_stale):
        """(level, what to save or None)."""
        name = collection.name
        if self.store_dir is None or self._store_path(name) is None:
            self.last_visual = "built"
            return build_visual_level(collection, name, version, self.threshold, self.chunk_size,
                                      self.block_rows), None

        current = image_entries(collection.get(include=["metadatas"]))
        # Any saved level of this collection will do, whoever wrote it: its images, pairs and embeddings were
        # written together, and everything that changed since is compared again
        saved = self._read_saved(name)
        if saved is not None:
            if self._same_images(saved.entries, current):
                self.last_visual = "loaded"
                return _level_from(name, version, saved.entries, saved.pairs.tolist(), saved.token), None
            if reuse_stale:
                # Indexing: the saved level as it is, stale (version None), brought up to date afterwards
                self.last_visual = "loaded"
                return _level_from(name, None, saved.entries, saved.pairs.tolist(), saved.token), None
            updated = self._update(collection, version, saved, current)
            if updated is not None:
                self.last_visual = "updated"
                return updated

        keep = {}
        token = uuid.uuid4().hex
        level = build_visual_level(collection, name, version, self.threshold, self.chunk_size, self.block_rows,
                                   token=token, keep=keep)
        self.last_visual = "built"
        return level, keep

    @staticmethod
    def _same_images(saved_entries, current):
        if len(saved_entries) != len(current):
            return False
        by_key = {entry.key: entry for entry in saved_entries}
        for entry in current:
            other = by_key.get(entry.key)
            if other is None or other.signature != entry.signature or other.path != entry.path:
                return False
        return True

    def _update(self, collection, version, saved, current):
        """The level of `current` from the saved one: the pairs of unchanged images are kept, the changed and new
        images are read and compared with every image. None when a full build is the better way (too many
        changes, or the saved embeddings can't be read)."""
        old_rows = {entry.key: row for row, entry in enumerate(saved.entries)}
        unchanged, old_positions, fresh = [], [], []
        for entry in current:
            row = old_rows.get(entry.key)
            old = saved.entries[row] if row is not None else None
            if old is not None and old.signature == entry.signature and old.path == entry.path:
                unchanged.append(entry)
                old_positions.append(row)
            else:
                fresh.append(entry)
        if len(fresh) > MAX_CHANGED_SHARE * max(len(current), 1):
            return None
        old_matrix = self._read_saved_matrix(saved)
        if old_matrix is None:
            return None
        dims = old_matrix.shape[1]
        kept_part = old_matrix[old_positions] if old_positions else None
        del old_matrix  # only the kept rows are needed from here on: the peak stays near a full build's
        fresh, fresh_matrix = _read_embeddings(collection, fresh, self.chunk_size)
        if fresh and kept_part is not None and fresh_matrix.shape[1] != dims:
            return None  # embeddings of another size: not the model the file was made with
        if kept_part is None:
            matrix = fresh_matrix if fresh else np.zeros((0, 0), dtype=np.float32)
        else:
            matrix = np.concatenate([kept_part, fresh_matrix]) if fresh else kept_part
        del kept_part, fresh_matrix
        entries = unchanged + fresh

        new_row = {old: new for new, old in enumerate(old_positions)}
        pairs = set()
        for row, col in saved.pairs.tolist():
            a, b = new_row.get(row), new_row.get(col)
            if a is not None and b is not None:
                pairs.add((a, b) if a < b else (b, a))
        pairs |= _links(matrix, [entry.hash for entry in entries], self.threshold, self.block_rows,
                        first_row=len(unchanged))
        token = uuid.uuid4().hex
        level = _level_from(collection.name, version, entries, pairs, token)
        return level, {"entries": entries, "pairs": _pair_array(pairs), "matrix": matrix}

    # --- the saved level ------------------------------------------------------------------------------------

    def _store_path(self, collection_name):
        if self.store_dir is None or not isinstance(collection_name, str) or not _SAFE_NAME.match(collection_name):
            return None
        return self.store_dir / f"{collection_name}.visual.npz"

    def _read_saved(self, collection_name):
        """The saved level of `collection_name` without its embeddings, or None when there is none or it does not
        fit (another format, collection or threshold, or a damaged file)."""
        path = self._store_path(collection_name)
        if path is None or not path.is_file():
            return None
        try:
            with np.load(path, allow_pickle=False) as data:
                header = json.loads(bytes(np.asarray(data["header"], dtype=np.uint8)).decode("ascii"))
                pairs = np.asarray(data["pairs"])
            if (header.get("format") != SAVE_FORMAT or header.get("collection") != collection_name
                    or header.get("threshold") != self.threshold or not isinstance(header.get("token"), str)):
                return None
            entries = []
            for record_id, recorded_path, file_hash, signature in header["rows"]:
                entries.append(ImageEntry(os.path.normcase(recorded_path), record_id, recorded_path, file_hash,
                                          tuple(signature)))
            if len({entry.key for entry in entries}) != len(entries):
                raise ValueError("a file is listed twice")
            if pairs.dtype.kind not in "iu":
                raise ValueError("the pairs are not integers")
            if pairs.size and (pairs.ndim != 2 or pairs.shape[1] != 2 or pairs.min() < 0
                               or pairs.max() >= len(entries) or bool((pairs[:, 0] >= pairs[:, 1]).any())):
                raise ValueError("pairs out of range")
            return _Saved(header["token"], entries, pairs.reshape(-1, 2).astype(np.int64), path)
        except Exception as e:
            self.log(f"[Duplicates] Ignoring the saved look-alike index of {collection_name}: {e}")
            return None

    def _read_saved_matrix(self, saved):
        try:
            with np.load(saved.path, allow_pickle=False) as data:
                # The file is opened again here: its token says it is still the save the images came from
                if str(data["token"]) != saved.token:
                    raise ValueError("the file was replaced meanwhile")
                matrix = np.asarray(data["matrix"])
            if matrix.dtype != np.float32 or matrix.ndim != 2 or matrix.shape[0] != len(saved.entries):
                raise ValueError("the embeddings don't match the images")
            return matrix
        except Exception as e:
            self.log(f"[Duplicates] Rebuilding the look-alike index: the saved embeddings can't be used ({e})")
            return None

    def _save(self, collection_name, token, entries, pairs, matrix):
        """Writes the level next to its collection's other saved files (atomically: a reader sees the old file or
        the new one). A failure is logged and leaves no temporary file; the level in memory is not affected."""
        path = self._store_path(collection_name)
        if path is None:
            return
        header = {"format": SAVE_FORMAT, "collection": collection_name, "threshold": self.threshold, "token": token,
                  "rows": [[entry.record_id, entry.path, entry.hash, list(entry.signature)] for entry in entries]}
        # ensure_ascii keeps paths that are not valid UTF-8 (lone surrogates) intact
        blob = np.frombuffer(json.dumps(header, ensure_ascii=True).encode("ascii"), dtype=np.uint8)
        temporary = path.with_name(f"{path.name}.{os.getpid()}.{token}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._remove_leftovers(path)
            with open(temporary, "wb") as handle:
                np.savez(handle, header=blob, token=np.asarray(token), pairs=pairs.astype(np.int32),
                         matrix=np.ascontiguousarray(matrix, dtype=np.float32))
            os.replace(temporary, path)
        except Exception as e:
            self.log(f"[Duplicates] Could not save the look-alike index of {collection_name}: {e}")
            try:
                temporary.unlink()
            except OSError:
                pass
