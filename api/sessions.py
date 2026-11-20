"""Signed session cookies for the network listener. Nothing is stored on the server: a cookie carries an
account id and its expiry, signed with a key made from the server secret and that account's password hash
and session salt. So a new password or a new salt ("sign out this account") ends that account's sessions,
deleting or turning off the account ends them too, and a new server secret ends them all."""
import base64
import hashlib
import hmac
import re
import secrets
import time
from typing import NamedTuple

SESSION_SECONDS = 30 * 24 * 3600
_VERSION = "2"
_MAX_TOKEN_LENGTH = 200
_ACCOUNT_ID = re.compile(r"^[0-9a-f]{12}$")


class Session(NamedTuple):
    account_id: str
    expires: int
    nonce: str = ""  # tells two sign-ins of one account apart (confirm_memory)


def new_secret() -> str:
    return secrets.token_hex(32)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _signature(secret: str, account, scheme: str, body: str) -> str:
    key = hmac.new(
        secret.encode("utf-8"),
        f"vblis-session|{account.id}|{account.password}|{account.session_salt}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    # The scheme is signed too: a cookie that travelled over plain HTTP is not accepted over HTTPS
    return _b64(hmac.new(key, f"{scheme}|{body}".encode("utf-8"), hashlib.sha256).digest())


def issue(secret: str, account, scheme: str, now=None, lifetime=SESSION_SECONDS) -> str:
    """A cookie value for `account` (an accounts.Account that can sign in)."""
    if not secret or not getattr(account, "can_sign_in", False) or not _ACCOUNT_ID.match(account.id or ""):
        raise ValueError("a session needs the server secret and an account that can sign in")
    expires = int(time.time() if now is None else now) + int(lifetime)
    body = f"{_VERSION}.{account.id}.{expires}.{secrets.token_hex(8)}"
    return f"{body}.{_signature(secret, account, scheme, body)}"


def verify(token, secret: str, find_account, scheme: str, now=None):
    """The Session a cookie value stands for, or None. find_account(id) returns the current
    accounts.Account with that id, or None."""
    if not isinstance(token, str) or not token.isascii() or len(token) > _MAX_TOKEN_LENGTH or not secret:
        return None
    parts = token.split(".")
    if len(parts) != 5:
        return None
    version, account_id, expires_text, nonce, signature = parts
    if version != _VERSION or not _ACCOUNT_ID.match(account_id) or not expires_text.isdigit():
        return None
    account = find_account(account_id)
    if account is None or not account.can_sign_in:
        return None
    body = token.rsplit(".", 1)[0]
    expected = _signature(secret, account, scheme, body)
    if not hmac.compare_digest(signature.encode("ascii"), expected.encode("ascii")):
        return None
    expires = int(expires_text)
    if expires <= (time.time() if now is None else now):
        return None
    return Session(account_id, expires, nonce)


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
