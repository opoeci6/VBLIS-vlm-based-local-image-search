"""Background warm-up of what the first library view, Filters panel and filtered search would otherwise build
while the user waits: the cached metadata scan, the media registry snapshot, the place map and the exact-copy
level. The look-alike level is only rebuilt here, never built for the first time, so it costs nothing until the
"Visual duplicates" filter was used with this collection.

One daemon thread, started by the first request. It only reads, through the same caches the requests use, so a
request never waits for it and a write that lands meanwhile still wins (each cache checks its own version). It
does nothing while the library is being indexed: every batch would make the work stale again."""
import threading
import time


class CacheWarmer:
    def __init__(self, indexer, delay=0.5, log=print):
        self.indexer = indexer
        self.delay = delay  # seconds between a request and the run: lets a queued index task start first
        self.log = log
        self.last_run = None  # (names of the finished steps, seconds), for tests and benches
        self._lock = threading.Lock()  # guards the three fields below
        self._thread = None
        self._pending = False
        self._stopped = False
        self._wake = threading.Event()
        self._idle = threading.Event()
        self._idle.set()

    def request(self):
        """Asks for a warm-up soon (after start, a model switch, a finished task, a deleted folder). Returns at
        once; requests made before the run starts count as one."""
        with self._lock:
            if self._stopped:
                return
            self._pending = True
            self._idle.clear()
            if self._thread is None:
                self._thread = threading.Thread(target=self._loop, name="cache-warmer", daemon=True)
                self._thread.start()
        self._wake.set()

    def stop(self, timeout=2.0):
        """Ends the thread; a running step is not interrupted, so this waits at most `timeout` seconds."""
        with self._lock:
            self._stopped = True
            thread = self._thread
        self._wake.set()
        if thread is not None:
            thread.join(timeout)

    def wait_idle(self, timeout=None):
        """True once no warm-up is pending or running (for tests and benches)."""
        return self._idle.wait(timeout)

    def _loop(self):
        while True:
            self._wake.wait()
            self._wake.clear()
            with self._lock:
                if self._stopped:
                    self._idle.set()
                    return
                if not self._pending:
                    continue
            if self.delay:
                time.sleep(self.delay)
            with self._lock:
                self._pending = False
            try:
                self.run_once()
            except Exception as e:  # a warm-up must never take the thread down
                self.log(f"[Warmup] Stopped early: {e}")
            with self._lock:
                if not self._pending:
                    self._idle.set()

    def _should_stop(self, collection):
        indexer = self.indexer
        return (self._stopped or self._pending or indexer.is_indexing
                or indexer.collection is not collection)

    def run_once(self):
        """One warm-up of the active collection, in the calling thread. Returns the names of the steps that
        finished; it ends early when indexing starts, the collection is switched or a new request arrives."""
        indexer = self.indexer
        collection = indexer.collection
        started = time.perf_counter()
        done = []
        if collection is None:
            self.last_run = (done, 0.0)
            return done

        def places():
            if indexer.places.available:
                indexer.places.ids(indexer.media_registry.snapshot())

        steps = (
            ("scan", lambda: collection.get(include=["metadatas"])),
            ("details", indexer.media_registry.snapshot),
            ("places", places),
            ("copies", lambda: indexer.duplicate_index.exact_level(collection)),
            ("look-alikes", lambda: indexer.duplicate_index.refresh_visual(collection)),
        )
        for name, step in steps:
            if self._should_stop(collection):
                break
            try:
                if step() is not False:
                    done.append(name)
            except Exception as e:
                self.log(f"[Warmup] Step '{name}' failed: {e}")
        seconds = time.perf_counter() - started
        self.last_run = (done, seconds)
        if done and seconds >= 0.05:
            self.log(f"[Warmup] {', '.join(done)} ready in {seconds:.2f} s")
        return done
