import threading


class CachedCollection:
    """Thin proxy around a Chroma collection that caches the full-metadata scan.

    The polled folder endpoints each run collection.get(include=["metadatas"]) over the whole collection.
    Only that exact call is cached; every other attribute and call goes straight to the wrapped collection.
    Any mutation made through the proxy (add, delete, update, upsert) drops the cached scan.
    """

    def __init__(self, collection):
        self._collection = collection
        self._lock = threading.Lock()
        self._version = 0
        self._cached = None

    def __getattr__(self, name):
        # Only reached for attributes the proxy does not define itself
        return getattr(self.__dict__["_collection"], name)

    @staticmethod
    def _is_full_metadata_scan(args, kwargs):
        return not args and set(kwargs) == {"include"} and kwargs["include"] == ["metadatas"]

    @staticmethod
    def _copy_result(result):
        # Callers get their own lists so they can never corrupt the cached scan
        if not isinstance(result, dict):
            return result
        return {key: (list(value) if isinstance(value, list) else value) for key, value in result.items()}

    def _invalidate(self):
        with self._lock:
            self._version += 1
            self._cached = None

    def get(self, *args, **kwargs):
        if not self._is_full_metadata_scan(args, kwargs):
            return self._collection.get(*args, **kwargs)

        with self._lock:
            if self._cached is not None:
                return self._copy_result(self._cached)
            version = self._version

        result = self._collection.get(*args, **kwargs)

        with self._lock:
            # A mutation that ran while the scan was in flight bumps the version, so its stale scan is not kept
            if self._version == version:
                self._cached = result
        return self._copy_result(result)

    def _mutate(self, name, *args, **kwargs):
        try:
            return getattr(self._collection, name)(*args, **kwargs)
        finally:
            # Invalidate after the write (even a failed one may have partly applied) so a scan that started
            # before it can never be cached
            self._invalidate()

    def add(self, *args, **kwargs):
        return self._mutate("add", *args, **kwargs)

    def delete(self, *args, **kwargs):
        return self._mutate("delete", *args, **kwargs)

    def update(self, *args, **kwargs):
        return self._mutate("update", *args, **kwargs)

    def upsert(self, *args, **kwargs):
        return self._mutate("upsert", *args, **kwargs)
