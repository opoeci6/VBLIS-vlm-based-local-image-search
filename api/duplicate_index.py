"""The library-wide duplicate index behind the "Duplicates" search filter, the visual copies of the results and
the counts of the filter panel.

Two levels, each built from the active collection and keyed by (collection name, CachedCollection.version):
  * exact:  images that share a SHA-256 hash with another image file. Built from the cached metadata scan, so it
            is cheap and rebuilt whenever it is stale.
  * visual: images whose stored embeddings have a dot product of at least `threshold` with another image, a pair
            with the same non-empty hash excluded (that is an exact copy). Built with blocked matrix products
            over every image embedding of the library (seconds on tens of thousands of images), so the caller
            decides when it is worth building (see DuplicateIndex.ensure_visual).

Files that exist on disk are never recorded here: callers answer that at query time with their own
_FileExistenceCache. Videos never take part. A finished level is never changed, so readers need no lock; a
build only reads Chroma."""
import os
import threading

import numpy as np

BLOCK_ROWS = 2048  # rows of one E[s:e] @ E.T product: never the full N x N matrix


def _is_video(meta):
    # Image records written before video support have no media_type
    return meta.get("media_type", "image") == "video"


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

    def __init__(self, collection_name, version, neighbors, path_by_key):
        self.collection_name = collection_name
        self.version = version
        self.neighbors = neighbors      # normcased path -> frozenset of normcased paths (symmetric)
        self.path_by_key = path_by_key  # normcased path -> path as recorded (only files that have a partner)

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


def build_visual_level(collection, collection_name, version, threshold, chunk_size, block_rows):
    """The VisualLevel of every image record of `collection`. Embeddings are used as stored (the head pass of a
    search does the same) and read `chunk_size` ids per Chroma call; the products are float32, `block_rows`
    rows at a time, and the embedding matrix is gone when this returns."""
    scan = collection.get(include=["metadatas"])
    ids, paths, hashes = [], [], []
    seen = set()
    for record_id, meta in zip(scan.get("ids") or [], scan.get("metadatas") or []):
        path = meta.get("path") if meta else None
        if not path or _is_video(meta):
            continue
        key = os.path.normcase(path)
        if key in seen:
            continue
        seen.add(key)
        ids.append(record_id)
        paths.append(path)
        hashes.append(meta.get("hash") or "")

    kept = []     # positions in ids of the records that have an embedding
    chunks = []
    for start in range(0, len(ids), chunk_size):
        part = ids[start:start + chunk_size]
        fetched = collection.get(ids=part, include=["embeddings"])
        embeddings = fetched.get("embeddings")
        if embeddings is None:
            continue
        by_id = dict(zip(fetched.get("ids") or [], embeddings))
        rows = [(position, by_id[record_id]) for position, record_id in enumerate(part, start)
                if by_id.get(record_id) is not None]
        if rows:
            kept.extend(position for position, _ in rows)
            chunks.append(np.asarray([embedding for _, embedding in rows], dtype=np.float32))

    adjacency = {}  # row -> set of rows
    if len(kept) >= 2:
        matrix = np.concatenate(chunks)
        chunks = None
        hash_codes = {}
        codes = np.empty(len(kept), dtype=np.int64)
        for row, position in enumerate(kept):
            codes[row] = hash_codes.setdefault(hashes[position], len(hash_codes)) if hashes[position] else -1
        cut = np.float32(threshold)
        transposed = matrix.T
        for start in range(0, len(kept), block_rows):
            end = min(start + block_rows, len(kept))
            rows, cols = np.nonzero((matrix[start:end] @ transposed) >= cut)
            rows = rows + start
            wanted = (rows != cols) & ~((codes[rows] == codes[cols]) & (codes[rows] >= 0))
            # Both directions are recorded: a product at the threshold may round differently either way round
            for row, col in zip(rows[wanted].tolist(), cols[wanted].tolist()):
                adjacency.setdefault(row, set()).add(col)
                adjacency.setdefault(col, set()).add(row)
        del matrix, transposed

    keys = [os.path.normcase(paths[position]) for position in kept]
    neighbors = {keys[row]: frozenset(keys[col] for col in cols) for row, cols in adjacency.items()}
    path_by_key = {keys[row]: paths[kept[row]] for row in adjacency}
    return VisualLevel(collection_name, version, neighbors, path_by_key)


class DuplicateIndex:
    """The two levels of the active collection (see the module docstring). One per Indexer.

    Thread safety: searches run in a thread pool. Each level has a lock so that only one build of it runs at a
    time; a request that needs a level waits for the running build and reuses its result when that is still
    good enough. A finished level is published by one attribute assignment, so a reader that takes no lock sees
    a complete level or none. `reset` (a collection switch) invalidates builds that are running."""

    def __init__(self, threshold, chunk_size, block_rows=BLOCK_ROWS):
        self.threshold = threshold
        self.chunk_size = chunk_size
        self.block_rows = block_rows
        self._exact = None
        self._visual = None
        self._exact_lock = threading.Lock()
        self._visual_lock = threading.Lock()
        self._state_lock = threading.Lock()  # guards publishing against reset
        self._generation = 0

    def reset(self):
        """Forgets both levels (the collection was switched, cleared or deleted); a build that started before
        the reset is not published."""
        with self._state_lock:
            self._generation += 1
            self._exact = None
            self._visual = None

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
        """The visual level of `collection`, built first when there is none. A stale one is rebuilt unless
        `reuse_stale` (the library is being indexed: it would be stale again after every batch)."""
        level = self._visual
        if self._usable_visual(level, collection, reuse_stale):
            return level
        with self._visual_lock:
            level = self._visual
            if self._usable_visual(level, collection, reuse_stale):
                return level
            generation = self._generation
            version = self._version_of(collection)
            level = build_visual_level(collection, collection.name, version, self.threshold, self.chunk_size,
                                       self.block_rows)
            self._publish("_visual", level, generation)
            return level

    def refresh_visual(self, collection):
        """Rebuilds the visual level of `collection` when there is one and it is stale (the background warm-up
        after indexing). Never builds a first one. True when the level is current afterwards, False when there
        is none."""
        if self.existing_visual(collection) is None:
            return False
        self.ensure_visual(collection)
        return True

    @classmethod
    def _usable_visual(cls, level, collection, reuse_stale):
        if level is None or level.collection_name != collection.name:
            return False
        return reuse_stale or cls._is_fresh(level, collection)
