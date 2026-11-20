"""Signed session cookies for the network listener. Nothing is stored on the server: a cookie
carries the role and its expiry, signed with a key made from the server secret and that role's
password hash. So changing a password ends that role's sessions, and a new secret ends them all."""
import base64
import hashlib
import hmac
import secrets
import time
from typing import NamedTuple

ROLES = ("owner", "viewer")
SESSION_SECONDS = 30 * 24 * 3600
_VERSION = "1"
_MAX_TOKEN_LENGTH = 200


class Session(NamedTuple):
    role: str
    expires: int


def new_secret() -> str:
    return secrets.token_hex(32)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _signature(secret: str, role: str, password_hash: str, scheme: str, body: str) -> str:
    key = hmac.new(
        secret.encode("utf-8"), f"vblis-session|{role}|{password_hash}".encode("utf-8"), hashlib.sha256
    ).digest()
    # The scheme is signed too: a cookie that travelled over plain HTTP is not accepted over HTTPS
    return _b64(hmac.new(key, f"{scheme}|{body}".encode("utf-8"), hashlib.sha256).digest())


def issue(secret: str, role: str, password_hash: str, scheme: str, now=None, lifetime=SESSION_SECONDS) -> str:
    if role not in ROLES or not secret or not password_hash:
        raise ValueError("a session needs a role, the server secret and that role's password hash")
    expires = int(time.time() if now is None else now) + int(lifetime)
    body = f"{_VERSION}.{role}.{expires}.{secrets.token_hex(8)}"
    return f"{body}.{_signature(secret, role, password_hash, scheme, body)}"


def verify(token, secret: str, password_hashes: dict, scheme: str, now=None):
    """The Session a cookie value stands for, or None. password_hashes maps each role to its
    stored password string (None when the role has no password)."""
    if not isinstance(token, str) or not token.isascii() or len(token) > _MAX_TOKEN_LENGTH or not secret:
        return None
    parts = token.split(".")
    if len(parts) != 5:
        return None
    version, role, expires_text, _nonce, signature = parts
    if version != _VERSION or role not in ROLES or not expires_text.isdigit():
        return None
    password_hash = password_hashes.get(role)
    if not password_hash:
        return None
    body = token.rsplit(".", 1)[0]
    expected = _signature(secret, role, password_hash, scheme, body)
    if not hmac.compare_digest(signature.encode("ascii"), expected.encode("ascii")):
        return None
    expires = int(expires_text)
    if expires <= (time.time() if now is None else now):
        return None
    return Session(role, expires)


def cookie_name(scheme: str, port: int) -> str:
    """Cookies are shared by every port of a host, so the port is part of the name. Over HTTPS
    the __Host- prefix makes the browser insist on Secure, Path=/ and no Domain."""
    return f"__Host-vblis_{port}" if scheme == "https" else f"vblis_{port}"


def set_cookie_header(name: str, value: str, scheme: str, max_age: int = SESSION_SECONDS) -> str:
    secure = "; Secure" if scheme == "https" else ""
    return f"{name}={value}; Path=/; Max-Age={int(max_age)}; HttpOnly; SameSite=Strict{secure}"


def clear_cookie_header(name: str, scheme: str) -> str:
    return set_cookie_header(name, "", scheme, max_age=0)


def read_cookies(header_value, name: str) -> list:
    """Every value the Cookie header holds for name. A browser can send several (an old cookie
    from another path, or one planted from a sibling port), so the caller accepts any valid one."""
    if not isinstance(header_value, str):
        return []
    values = []
    for part in header_value.split(";"):
        key, sep, value = part.strip().partition("=")
        if sep and key == name and value:
            values.append(value)
    return values
