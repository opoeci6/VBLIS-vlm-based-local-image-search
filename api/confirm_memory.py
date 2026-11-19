"""Remembers for a few minutes that a signed-in account confirmed its own password in the browser's
Accounts window, so the next changes there don't ask again.

An entry belongs to one sign-in from one address: the account, the session cookie's nonce and the client's
address. A stolen cookie used from another address gets nothing, and signing in again starts over. (Devices
behind one address, such as a home router seen from the internet, share it; then the sign-in alone counts.)
Each
entry also keeps a stamp of the account (role, password hash, session salt): when any of them changes
(from the command line, the desktop app or another browser), the entry no longer counts. The time is
fixed from the confirmation and is not extended by use. Nothing is written to disk: a restart of the
listener forgets everything.

What it may cover is decided in routers/server_settings.py: never owner access or your own account.

Known limit: an entry is checked when it is used. A role changed and changed back from the command line
within the window (the stamp matches again) leaves it counting; the desktop app and the browser forget it
on any role change."""
import threading
import time
from collections import OrderedDict

REMEMBER_SECONDS = 300
MAX_ENTRIES = 256


def _stamp(account) -> tuple:
    return (account.role, account.password, account.session_salt)


class RecentConfirmations:
    def __init__(self, seconds=REMEMBER_SECONDS, max_entries=MAX_ENTRIES, clock=time.monotonic):
        self.seconds = max(0, int(seconds))
        self.max_entries = max(1, int(max_entries))
        self._clock = clock
        self._entries = OrderedDict()  # (account id, nonce, client) -> (until, stamp)
        self._lock = threading.Lock()

    def remember(self, account, nonce, client) -> int:
        """Remember a correct confirmation by `account` (as it is now) in the session with `nonce`.
        Returns the seconds it counts for (0 when nothing is remembered)."""
        if self.seconds <= 0 or account is None or not nonce or not account.can_sign_in:
            return 0
        key = (account.id, nonce, client)
        with self._lock:
            self._entries.pop(key, None)
            self._entries[key] = (self._clock() + self.seconds, _stamp(account))
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
        return self.seconds

    def remaining(self, account, nonce, client) -> float:
        """Seconds left for this account (as it is now) in this session from this client, or 0."""
        if account is None or not nonce:
            return 0.0
        key = (account.id, nonce, client)
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return 0.0
            until, stamp = entry
            left = until - self._clock()
            if left <= 0 or stamp != _stamp(account) or not account.can_sign_in:
                del self._entries[key]
                return 0.0
            return left

    def forget(self, account_id, nonce=None) -> None:
        """Forget one session's entries (nonce given), or every entry of the account."""
        with self._lock:
            for key in [k for k in self._entries if k[0] == account_id and (nonce is None or k[1] == nonce)]:
                del self._entries[key]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
