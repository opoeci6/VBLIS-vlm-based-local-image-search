"""Query refs: a finished search keeps its query embedding for a while, so the frontend can ask for more
(a different Max Results / threshold, the frames of one video) without the client sending the query again.
Kept in memory only; the oldest refs are dropped first."""
import collections
import threading
import uuid
from typing import NamedTuple, Optional

from search_scoring import ScoreParams

EXPIRED_MESSAGE = "This search has expired. Please search again."
MODEL_CHANGED_MESSAGE = "The active model changed. Please search again."


class SearchSessionExpired(Exception):
    """The query ref is unknown (never issued, or evicted) or belongs to another collection."""


class SearchSession(NamedTuple):
    collection_name: str
    kind: str  # "text" or "image"
    embedding: list
    score_params: Optional[ScoreParams]  # None for image queries and models without calibration
    query: Optional[str]  # text queries only


class SearchSessions:
    """Thread-safe LRU of SearchSession by ref."""

    def __init__(self, capacity=32):
        self._capacity = max(1, capacity)
        self._lock = threading.Lock()
        self._sessions = collections.OrderedDict()

    def put(self, session: SearchSession) -> str:
        ref = uuid.uuid4().hex
        with self._lock:
            self._sessions[ref] = session
            while len(self._sessions) > self._capacity:
                self._sessions.popitem(last=False)
        return ref

    def get(self, ref) -> Optional[SearchSession]:
        if not ref:
            return None
        with self._lock:
            session = self._sessions.get(ref)
            if session is not None:
                self._sessions.move_to_end(ref)
            return session
