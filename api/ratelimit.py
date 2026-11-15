"""A limiter for password attempts on the network listener: fixed windows, per client and per
group (local network or internet), so guessing from the internet can't lock out the local network.

Call begin() before the password is hashed. It counts the attempt at once, so parallel requests
can't all slip past the check, and returns how long to wait when the client is blocked. Then call
succeeded() for a correct password, which takes the attempt back."""
import ipaddress
import threading
import time

import netaddr

PRIVATE = "private"
PUBLIC = "public"


def client_key(host) -> str:
    """What the per-client count is kept by: the address, or its /64 for IPv6, since one home
    or server usually holds a whole /64."""
    address = netaddr.parse_ip(host)
    if address is None:
        return "unknown"
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def client_group(host) -> str:
    return PRIVATE if netaddr.is_private_client(host) else PUBLIC


class AttemptLimiter:
    def __init__(self, per_client=5, overall=30, window=60.0, clock=time.monotonic):
        self._per_client = per_client
        self._overall = overall
        self._window = window
        self._clock = clock
        self._lock = threading.Lock()
        self._clients = {}  # key -> [window start, attempts]
        self._groups = {}  # group -> [window start, attempts]
        # account id -> [window start, attempts]: a signed-in account confirming its own password, so a
        # stolen session can't guess that password from many addresses at once
        self._accounts = {}

    def _entry(self, table, key, now):
        entry = table.get(key)
        if entry is None or now - entry[0] >= self._window:
            entry = table[key] = [now, 0]
        return entry

    def _wait(self, entry, limit, now) -> float:
        return self._window - (now - entry[0]) if entry[1] >= limit else 0.0

    def begin(self, host, shared=True, account=None) -> float:
        """0.0 and the attempt counted, or the seconds to wait (nothing counted). shared=False
        leaves the group count out: for someone already signed in, confirming their own password,
        whom guessing elsewhere must not block. `account` (that account's id) adds a count per
        account, as strict as the per-client one."""
        now = self._clock()
        key, group = client_key(host), client_group(host)
        with self._lock:
            client = self._entry(self._clients, key, now)
            wait = self._wait(client, self._per_client, now)
            group_entry = self._entry(self._groups, group, now) if shared else None
            if group_entry is not None:
                wait = max(wait, self._wait(group_entry, self._overall, now))
            account_entry = self._entry(self._accounts, account, now) if account else None
            if account_entry is not None:
                wait = max(wait, self._wait(account_entry, self._per_client, now))
            if wait > 0:
                return wait
            client[1] += 1
            if group_entry is not None:
                group_entry[1] += 1
            if account_entry is not None:
                account_entry[1] += 1
            if len(self._clients) > 1000:
                self._clients = {k: v for k, v in self._clients.items() if now - v[0] < self._window}
            if len(self._accounts) > 1000:
                self._accounts = {k: v for k, v in self._accounts.items() if now - v[0] < self._window}
            return 0.0

    def succeeded(self, host, shared=True, clear=False, account=None) -> None:
        """A correct password: its attempt doesn't count. clear=True (the owner) also forgets the
        client's earlier failures; a viewer's password doesn't, so it can't be used to reset the
        count while guessing the owner's. An account's own count is only refunded, never cleared."""
        now = self._clock()
        key, group = client_key(host), client_group(host)
        with self._lock:
            client = self._clients.get(key)
            if client is not None:
                if clear:
                    self._clients.pop(key, None)
                elif client[1] > 0 and now - client[0] < self._window:
                    client[1] -= 1
            entry = self._groups.get(group) if shared else None
            if entry is not None and entry[1] > 0 and now - entry[0] < self._window:
                entry[1] -= 1
            account_entry = self._accounts.get(account) if account else None
            if account_entry is not None and account_entry[1] > 0 and now - account_entry[0] < self._window:
                account_entry[1] -= 1
