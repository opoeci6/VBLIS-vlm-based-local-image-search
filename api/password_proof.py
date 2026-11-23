"""Proving a password without sending it (network listener and the Accounts window).

The browser never sends a password. To sign in, or to confirm a change with its own password, it first
asks for a challenge. With it come the account's scrypt salt and cost values, so the browser can derive
the same key the stored hash holds (passwords.derive_key: UTF-8, scrypt, 32 bytes). It answers with

    proof = HMAC-SHA256(key, "vblis-proof-v1|<purpose>|<challenge>")

in URL-safe base64 without padding. A challenge is used once, lasts two minutes, and belongs to the
purpose, the account (its name for signing in; its id and the sign-in for a confirmation) and the
client address it was given to. A new password arrives already hashed (new_hash_problem): the server
checks its form and stores it as it is.

What this gives: the password itself never crosses the network or shows in the browser's developer
tools, and a proof can't be used twice. On plain HTTP someone listening can still try to guess the
password from a proof, at the cost of one scrypt per guess, as with a copy of server.json.

What it costs: the stored hash is now enough to sign in. server.json also holds the session secret,
which signs cookies, so a copy of it was already enough. The length rules for a new password are checked
in the browser only; skipping them only weakens an account the sender may set the password of anyway.

A name with no account (or an account without a password) gets a salt made from the session secret and
the name: the same one each time, so the answer doesn't show whether the name exists. Known limit: a
real account's salt changes when its password changes, a made-up one only with "sign out everywhere"."""
import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import OrderedDict
from typing import Optional

import passwords
import ratelimit

PROOF_VERSION = "vblis-proof-v1"
SIGN_IN = "sign_in"
CONFIRM = "confirm"
PURPOSES = (SIGN_IN, CONFIRM)

CHALLENGE_SECONDS = 120
MAX_CHALLENGES = 1024
MAX_PER_CLIENT = 8
_CHALLENGE_BYTES = 32
# The longest challenge or proof a request may carry: both are 43 characters
FIELD_MAX = 64
# The longest new password hash a request may carry (scrypt$15$8$1$<22>$<43> is 72 characters)
HASH_FIELD_MAX = 200


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    """Bytes from URL-safe base64 without padding; ValueError for anything else."""
    if not isinstance(text, str) or not text.isascii() or "=" in text:
        raise ValueError("not base64")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class ChallengeStore:
    """The challenges given out and not used yet, in memory only (a restart forgets them).

    They are kept in shares, one per sign-in group (ratelimit: private, other local networks, public) and
    purpose, each with at most `max_entries`; when a share is full its oldest go first. So many clients
    asking from the internet can't push out a sign-in at home, and signed-in viewers asking for confirm
    challenges can't push out anyone's sign-in. Within a share, one client (its address, or its /64 for
    IPv6, as the attempt limiter counts) holds at most `per_client`. A challenge still belongs to the
    exact address it was given to."""

    def __init__(self, seconds=CHALLENGE_SECONDS, max_entries=MAX_CHALLENGES, per_client=MAX_PER_CLIENT,
                 clock=time.monotonic):
        self.seconds = max(1, int(seconds))
        self.max_entries = max(1, int(max_entries))
        self.per_client = max(1, int(per_client))
        self._clock = clock
        # (group, purpose) -> OrderedDict challenge -> (subject, client, client key, until)
        self._shares = {}
        self._share_of = {}  # challenge -> its share's key
        self._lock = threading.Lock()

    def _drop(self, share_key, value) -> None:
        self._shares[share_key].pop(value, None)
        self._share_of.pop(value, None)

    def issue(self, purpose: str, subject: str, client, group=None) -> str:
        """A new challenge for `purpose` and `subject`, given to `client`. `group`: the client's sign-in
        group as the gate placed it (None: from the address alone)."""
        if purpose not in PURPOSES:
            raise ValueError(f"unknown purpose {purpose!r}")
        value = _b64(secrets.token_bytes(_CHALLENGE_BYTES))
        key = ratelimit.client_key(client)
        share_key = (ratelimit.client_group(client, group), purpose)
        with self._lock:
            share = self._shares.setdefault(share_key, OrderedDict())
            now = self._clock()
            while share:
                oldest = next(iter(share))
                if share[oldest][3] > now:
                    break
                self._drop(share_key, oldest)
            mine = [item for item, entry in share.items() if entry[2] == key]
            for item in mine[: max(0, len(mine) - self.per_client + 1)]:
                self._drop(share_key, item)
            share[value] = (subject, client, key, now + self.seconds)
            self._share_of[value] = share_key
            while len(share) > self.max_entries:
                self._drop(share_key, next(iter(share)))
        return value

    def take(self, value, purpose: str, subject: str, client) -> bool:
        """Whether `value` was given out for this purpose, subject and client and hasn't expired. It is
        removed either way: one try per challenge."""
        if not isinstance(value, str):
            return False
        with self._lock:
            share_key = self._share_of.pop(value, None)
            entry = self._shares[share_key].pop(value, None) if share_key is not None else None
            now = self._clock()
        if entry is None:
            return False
        stored_subject, stored_client, _key, until = entry
        return share_key[1] == purpose and stored_subject == subject and stored_client == client and now < until

    def clear(self) -> None:
        with self._lock:
            self._shares.clear()
            self._share_of.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._share_of)


def made_up_salt(secret: str, subject: str) -> bytes:
    """The salt shown for a name without an account: stable for that name and server secret."""
    digest = hmac.new((secret or "").encode("utf-8"), f"vblis-made-up-salt|{subject}".encode("utf-8"),
                      hashlib.sha256).digest()
    return digest[: passwords.SALT_BYTES]


def challenge_answer(challenge: str, stored_hash, fallback_salt: bytes) -> dict:
    """What the browser needs to answer a challenge: the salt and cost values of `stored_hash`, or the
    made-up salt with the current costs when there is no usable hash."""
    parsed = passwords.parse_hash(stored_hash)
    if parsed is None:
        log_n, r, p = passwords.current_cost()
        salt = fallback_salt
    else:
        log_n, r, p, salt, _key = parsed
    return {"challenge": challenge, "salt": _b64(salt), "log_n": log_n, "r": r, "p": p}


def expected_proof(key: bytes, purpose: str, challenge: str) -> bytes:
    message = f"{PROOF_VERSION}|{purpose}|{challenge}".encode("ascii")
    return hmac.new(key, message, hashlib.sha256).digest()


def proof_matches(stored_hash, purpose: str, challenge: str, proof) -> bool:
    """Whether `proof` answers `challenge` for the password behind `stored_hash`. With no usable hash
    the same work is done against a random key, and the answer is False."""
    parsed = passwords.parse_hash(stored_hash)
    usable = parsed is not None
    key = parsed[4] if usable else secrets.token_bytes(passwords.KEY_BYTES)
    try:
        given = _unb64(proof)
    except (ValueError, TypeError):
        given = b""
    if not isinstance(challenge, str) or not challenge.isascii():
        return False
    return hmac.compare_digest(expected_proof(key, purpose, challenge), given) and usable


def prove(password: str, answer: dict, purpose: str) -> str:
    """The proof a browser sends for `answer` (from challenge_answer). For tests and tools; the server
    never calls it."""
    key = passwords.derive_key(password, _unb64(answer["salt"]), answer["log_n"], answer["r"], answer["p"])
    return _b64(expected_proof(key, purpose, answer["challenge"]))


def new_hash_problem(value) -> Optional[str]:
    """None when `value` is a new password hash in exactly the form this server writes (its current cost
    values, a 16-byte salt, a 32-byte key, canonical base64), else "password_hash_invalid"."""
    if not isinstance(value, str) or len(value) > HASH_FIELD_MAX:
        return "password_hash_invalid"
    parsed = passwords.parse_hash(value)
    if parsed is None:
        return "password_hash_invalid"
    log_n, r, p, salt, key = parsed
    if (log_n, r, p) != passwords.current_cost() or len(salt) != passwords.SALT_BYTES:
        return "password_hash_invalid"
    if len(key) != passwords.KEY_BYTES or passwords.encode_hash(log_n, r, p, salt, key) != value:
        return "password_hash_invalid"
    return None
