"""Per-file media facts (size, date taken, upright size, rotation, duration, GPS) in one SQLite file
that every collection shares. Writers probe files outside the lock and hand finished rows to upsert();
search reads an immutable in-memory snapshot that is rebuilt only after a write."""
import os
import sqlite3
import threading
import time
from types import MappingProxyType
from typing import Mapping, NamedTuple, Optional

SCHEMA_VERSION = 1
WRITE_CHUNK = 500

COLUMNS = (
    "key", "path", "media_type", "ext", "size", "mtime_ns", "width", "height", "orientation", "rotation",
    "duration_s", "taken_at", "taken_offset", "taken_source", "gps_lat", "gps_lon", "gps_alt",
    "probe_version", "error", "probed_at",
)

# _MIGRATIONS[v] upgrades a file from schema version v to v + 1 (version 0 is a new, empty file)
_MIGRATIONS = (
    (
        """CREATE TABLE media (
            key TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            media_type TEXT NOT NULL,
            ext TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            width INTEGER,
            height INTEGER,
            orientation INTEGER,
            rotation INTEGER,
            duration_s REAL,
            taken_at TEXT,
            taken_offset TEXT,
            taken_source TEXT,
            gps_lat REAL,
            gps_lon REAL,
            gps_alt REAL,
            probe_version INTEGER NOT NULL,
            error TEXT,
            probed_at REAL NOT NULL
        ) WITHOUT ROWID""",
    ),
)
assert len(_MIGRATIONS) == SCHEMA_VERSION

_UPSERT_SQL = (
    f"INSERT OR REPLACE INTO media ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})"
)


class MediaFacts(NamedTuple):
    """What search filters and the video index read for one file."""
    media_type: str
    ext: str
    width: Optional[int]
    height: Optional[int]
    taken_at: Optional[str]
    taken_source: Optional[str]
    duration_s: Optional[float]
    rotation: Optional[int]
    size: Optional[int] = None
    mtime_ns: Optional[int] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None


_FACT_COLUMNS = ("key",) + MediaFacts._fields


class RegistrySnapshot(NamedTuple):
    version: int
    facts: Mapping[str, MediaFacts]


_EMPTY_FACTS = MappingProxyType({})


class _NewerSchema(Exception):
    pass


def _is_broken_file(error: sqlite3.DatabaseError) -> bool:
    """True when the file itself is unreadable (not a database, or corrupt). Lock and I/O errors are
    not: a busy or unreachable file must never be renamed away."""
    name = getattr(error, "sqlite_errorname", None)
    if name:
        return name.startswith(("SQLITE_NOTADB", "SQLITE_CORRUPT"))
    return type(error) is sqlite3.DatabaseError


class MediaRegistry:
    """One connection guarded by one lock. The file is opened on first use, so constructing a registry
    creates nothing. While it can't be opened, reads are empty and writes are skipped: a file from a newer
    app version keeps it that way for good, a file that is not a database is renamed aside and created
    again (every row can be read again from the media files), and any other failure (a busy or unreachable
    file) is retried after RETRY_SECONDS."""

    RETRY_SECONDS = 30.0
    BUSY_TIMEOUT = 10.0  # seconds a statement waits for another connection's lock

    def __init__(self, db_path):
        self.db_path = os.fspath(db_path)
        self._lock = threading.Lock()
        self._snapshot_lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._disabled = False
        self._closed = False
        self._retry_at = 0.0
        self._last_warning = None
        self._version = 0  # bumped after every committed write
        self._snapshot: Optional[RegistrySnapshot] = None

    @staticmethod
    def key_for(path: str) -> str:
        return os.path.normcase(os.path.abspath(path))

    @property
    def available(self) -> bool:
        with self._lock:
            return self._connection() is not None

    # ------------------------------------------------------------------ connection (callers hold _lock)

    def _connection(self) -> Optional[sqlite3.Connection]:
        if self._conn is not None or self._disabled or self._closed or time.monotonic() < self._retry_at:
            return self._conn
        try:
            self._conn = self._open()
        except _NewerSchema as e:
            self._disabled = True
            self._warn(f"{self.db_path} was written by a newer version of VBLIS (schema {e}); media details are off")
        except sqlite3.DatabaseError as e:
            if not _is_broken_file(e):
                self._defer(f"cannot open {self.db_path}: {e}")
            elif not self._move_broken_file():
                self._defer(f"cannot move the unreadable {self.db_path} aside")
            else:
                try:
                    self._conn = self._open()
                except _NewerSchema as retry_error:
                    self._defer(f"cannot recreate {self.db_path}: schema {retry_error}")
                except (sqlite3.DatabaseError, OSError) as retry_error:
                    self._defer(f"cannot recreate {self.db_path}: {retry_error}")
        except OSError as e:
            self._defer(f"cannot open {self.db_path}: {e}")
        if self._conn is not None:
            self._last_warning = None
            self._version += 1  # rows written by an earlier run are visible now: rebuild the snapshot
        return self._conn

    def _defer(self, message: str):
        self._retry_at = time.monotonic() + self.RETRY_SECONDS
        self._warn(f"{message}; trying again in {self.RETRY_SECONDS:.0f} s")

    def _warn(self, message: str):
        # A file that stays busy fails every retry; say so once rather than every time
        if message != self._last_warning:
            self._last_warning = message
            print(f"[Warning] MediaRegistry: {message}")

    def _open(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=self.BUSY_TIMEOUT, isolation_level=None, check_same_thread=False)
        try:
            # Version first: switching a newer app's file to WAL would already rewrite its header
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise _NewerSchema(version)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            for from_version in range(version, SCHEMA_VERSION):
                self._transaction(conn, lambda: self._migrate(conn, from_version))
            return conn
        except BaseException:
            conn.close()
            raise

    @staticmethod
    def _migrate(conn: sqlite3.Connection, from_version: int):
        for statement in _MIGRATIONS[from_version]:
            conn.execute(statement)
        conn.execute(f"PRAGMA user_version = {from_version + 1}")

    def _transaction(self, conn: sqlite3.Connection, work):
        """Run work() in one write transaction. A failure anywhere, COMMIT included, rolls back; a connection
        that still can't leave the transaction is dropped, so the next call opens a fresh one."""
        conn.execute("BEGIN IMMEDIATE")
        try:
            result = work()
            conn.execute("COMMIT")
            return result
        except BaseException:
            # Some errors (a full disk) end the transaction themselves
            if conn.in_transaction:
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
            if conn.in_transaction and conn is self._conn:
                self._conn = None
                conn.close()
            raise

    def _move_broken_file(self) -> bool:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        try:
            for suffix in ("", "-wal", "-shm"):
                source = self.db_path + suffix
                if os.path.exists(source):
                    os.replace(source, f"{self.db_path}.broken-{stamp}{suffix}")
        except OSError as e:
            print(f"[Warning] MediaRegistry: cannot rename the unreadable {self.db_path}: {e}")
            return False
        print(f"[Warning] MediaRegistry: {self.db_path} was unreadable; kept it as .broken-{stamp} and started a new one")
        return True

    # ------------------------------------------------------------------ reads

    def stat_index(self) -> dict:
        """{key: (path, size, mtime_ns, probe_version)} for every row, in one read."""
        with self._lock:
            conn = self._connection()
            if conn is None:
                return {}
            rows = conn.execute("SELECT key, path, size, mtime_ns, probe_version FROM media").fetchall()
        return {key: (path, size, mtime_ns, probe_version) for key, path, size, mtime_ns, probe_version in rows}

    def count(self) -> int:
        with self._lock:
            conn = self._connection()
            if conn is None:
                return 0
            return conn.execute("SELECT COUNT(*) FROM media").fetchone()[0]

    def snapshot(self) -> RegistrySnapshot:
        """The facts of every row, rebuilt only when a write happened since the last call. The returned
        snapshot never changes, so callers can keep using it while writes go on. It never raises: when the
        file can't be read, the last good snapshot (or an empty one) comes back and the next call tries again."""
        snapshot = self._snapshot
        if snapshot is not None and snapshot.version == self._version:
            return snapshot
        with self._snapshot_lock:
            snapshot = self._snapshot
            if snapshot is not None and snapshot.version == self._version:
                return snapshot
            with self._lock:
                conn = self._connection()
                version = self._version  # read after _connection(), which bumps it when it opens the file
                if conn is None:
                    return snapshot or RegistrySnapshot(version, _EMPTY_FACTS)
                try:
                    rows = conn.execute(f"SELECT {', '.join(_FACT_COLUMNS)} FROM media").fetchall()
                except sqlite3.Error as e:
                    self._warn(f"cannot read {self.db_path}: {e}")
                    return snapshot or RegistrySnapshot(version, _EMPTY_FACTS)
            facts = MappingProxyType({row[0]: MediaFacts(*row[1:]) for row in rows}) if rows else _EMPTY_FACTS
            snapshot = RegistrySnapshot(version, facts)
            self._snapshot = snapshot
            return snapshot

    # ------------------------------------------------------------------ writes

    def upsert(self, rows) -> int:
        """Insert or replace whole rows (dicts keyed by COLUMNS; `key` defaults to key_for(path) and
        `probed_at` to now), one transaction per WRITE_CHUNK rows. Returns the number written."""
        now = time.time()
        values = []
        for row in rows:
            row = dict(row)
            row.setdefault("key", None)
            row["key"] = row["key"] or self.key_for(row["path"])
            row["probed_at"] = row.get("probed_at") or now
            values.append(tuple(row.get(column) for column in COLUMNS))
        written = 0
        for start in range(0, len(values), WRITE_CHUNK):
            chunk = values[start:start + WRITE_CHUNK]
            with self._lock:
                conn = self._connection()
                if conn is None:
                    return written
                self._transaction(conn, lambda: conn.executemany(_UPSERT_SQL, chunk))
                self._version += 1
            written += len(chunk)
        return written

    def delete(self, keys) -> int:
        """Delete rows by key. Returns the number of rows removed."""
        keys = list(keys)
        removed = 0
        for start in range(0, len(keys), WRITE_CHUNK):
            chunk = keys[start:start + WRITE_CHUNK]
            sql = f"DELETE FROM media WHERE key IN ({', '.join('?' * len(chunk))})"
            with self._lock:
                conn = self._connection()
                if conn is None:
                    return removed
                count = self._transaction(conn, lambda: conn.execute(sql, chunk).rowcount)
                if count:
                    self._version += 1
            removed += count
        return removed

    def close(self):
        """Close the file for good; later calls behave like a disabled registry. Safe to call twice."""
        with self._lock:
            self._closed = True
            if self._conn is not None:
                try:
                    self._conn.close()
                finally:
                    self._conn = None
