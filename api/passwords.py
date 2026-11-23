"""Password hashing for the network listener: scrypt from the standard library. A stored password
is one string, scrypt$<log2 n>$<r>$<p>$<salt>$<key>, with salt and key in URL-safe base64.

The command line hashes here. A browser hashes a new password itself and proves an existing one without
sending it (password_proof.py), with the same derivation: UTF-8, scrypt, 32 bytes."""
import base64
import hashlib
import hmac
import secrets

_LOG_N = 15
_R = 8
_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32
# scrypt needs 128 * n * r bytes (32 MiB with the values above). OpenSSL's default limit is
# lower and raises "memory limit exceeded", so the limit is passed explicitly.
_MAXMEM = 64 * 1024 * 1024

MIN_LENGTH = 8
MAX_LENGTH = 256

_dummy_hash = None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _derive(password: str, salt: bytes, log_n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8", "surrogatepass"),
        salt=salt, n=1 << log_n, r=r, p=p, maxmem=_MAXMEM, dklen=_KEY_BYTES,
    )


def password_problem(password):
    """None when the password may be used, else "empty", "too_short" or "too_long"."""
    if not isinstance(password, str) or not password.strip():
        return "empty"
    if len(password) < MIN_LENGTH:
        return "too_short"
    if len(password) > MAX_LENGTH:
        return "too_long"
    return None


SALT_BYTES = _SALT_BYTES
KEY_BYTES = _KEY_BYTES


def current_cost() -> tuple:
    """(log2 n, r, p) of a new hash. A function, not a constant: tests lower n to run faster."""
    return _LOG_N, _R, _P


def encode_hash(log_n: int, r: int, p: int, salt: bytes, key: bytes) -> str:
    return f"scrypt${log_n}${r}${p}${_b64(salt)}${_b64(key)}"


def derive_key(password: str, salt: bytes, log_n: int, r: int, p: int) -> bytes:
    """The key a stored hash holds for `password` (what a browser derives to prove it, password_proof.py)."""
    return _derive(password, salt, log_n, r, p)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    key = _derive(password, salt, _LOG_N, _R, _P)
    return encode_hash(_LOG_N, _R, _P, salt, key)


def _parse(encoded):
    """(log_n, r, p, salt, key) from a stored string, or None. The cost values are bounded, so
    an edited config file can't make a sign-in take minutes or gigabytes."""
    if not isinstance(encoded, str):
        return None
    parts = encoded.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return None
    try:
        log_n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        salt, key = _unb64(parts[4]), _unb64(parts[5])
    except (ValueError, TypeError):
        return None
    if not (10 <= log_n <= 17 and 1 <= r <= 16 and 1 <= p <= 4):
        return None
    if 128 * (1 << log_n) * r > _MAXMEM or len(salt) < 8 or len(key) != _KEY_BYTES:
        return None
    return log_n, r, p, salt, key


def parse_hash(encoded):
    """(log_n, r, p, salt, key) from a stored hash, or None when it isn't one this server accepts."""
    return _parse(encoded)


def is_password_hash(encoded) -> bool:
    return _parse(encoded) is not None


def verify_password(password, encoded) -> bool:
    """True when password matches the stored string. A missing or unreadable stored string costs
    the same work as a real one and gives False, so timing doesn't show whether a role has a password."""
    global _dummy_hash
    parsed = _parse(encoded)
    usable = parsed is not None
    if not usable:
        if _dummy_hash is None:
            _dummy_hash = hash_password(secrets.token_hex(16))
        parsed = _parse(_dummy_hash)
    if not isinstance(password, str) or len(password) > MAX_LENGTH:
        password = ""
        usable = False
    log_n, r, p, salt, key = parsed
    try:
        candidate = _derive(password, salt, log_n, r, p)
    except (ValueError, OverflowError, MemoryError):
        return False
    return hmac.compare_digest(candidate, key) and usable
