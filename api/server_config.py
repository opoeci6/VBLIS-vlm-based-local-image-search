"""Settings of the network listener, kept in <data>/data/server.json.

The file holds the password hashes and the session secret, so it is written atomically and, on
Linux, readable by its owner only. A few VBLIS_SERVER_* environment variables override the file
(for Docker and systemd); they are read when this module is imported, which bootstrap does before
.env is loaded, so .env can't change them."""
import contextlib
import json
import os
import tempfile
import threading
import time
from dataclasses import dataclass, replace

import netaddr
import passwords
import paths
import sessions

CONFIG_FILE_NAME = "server.json"
FILE_VERSION = 1
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DESKTOP_PORT = 8000
TLS_MODES = ("off", "files", "self_signed")
# Viewer permissions the owner can grant, with their defaults
VIEWER_PERMISSIONS = {"originals": False, "image_search": True}

ENV_PREFIX = "VBLIS_SERVER_"
ENV_SNAPSHOT = {key: value for key, value in os.environ.items() if key.startswith(ENV_PREFIX)}
_ENV_FIELDS = {
    "HOST": "host",
    "PORT": "port",
    "TLS": "tls_mode",
    "CERT_FILE": "cert_file",
    "KEY_FILE": "key_file",
    "LIBRARY_ROOTS": "library_roots",
    "ALLOWED_HOSTS": "allowed_hosts",
    "PUBLIC_ACCESS": "public_access",
    "TRUSTED_PROXIES": "trusted_proxies",
}
_RELOAD_INTERVAL = 1.0
_LOCK_TIMEOUT = 5.0


class ServerConfigError(RuntimeError):
    """The config file exists but can't be used; it is never overwritten in that state."""


@dataclass(frozen=True)
class ServerConfig:
    enabled: bool = False
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    tls_mode: str = "off"
    cert_file: str = ""
    key_file: str = ""
    allowed_hosts: tuple = ()
    library_roots: tuple = ()
    public_access: bool = False
    trusted_proxies: tuple = ()
    owner_password: str = ""
    viewer_password: str = ""
    session_secret: str = ""
    viewer_grants: frozenset = frozenset(name for name, on in VIEWER_PERMISSIONS.items() if on)
    # Not stored: what loading found
    env_fields: frozenset = frozenset()
    problems: tuple = ()
    load_error: str = ""

    @property
    def password_hashes(self) -> dict:
        return {"owner": self.owner_password or None, "viewer": self.viewer_password or None}

    def viewer_may(self, permission: str) -> bool:
        return permission in self.viewer_grants

    @property
    def secure(self) -> bool:
        return self.tls_mode != "off"

    def to_json(self) -> dict:
        return {
            "version": FILE_VERSION,
            "enabled": self.enabled,
            "host": self.host,
            "port": self.port,
            "tls": {"mode": self.tls_mode, "cert_file": self.cert_file, "key_file": self.key_file},
            "allowed_hosts": list(self.allowed_hosts),
            "library_roots": list(self.library_roots),
            "public_access": self.public_access,
            "trusted_proxies": list(self.trusted_proxies),
            "viewer_permissions": {name: name in self.viewer_grants for name in VIEWER_PERMISSIONS},
            "passwords": {"owner": self.owner_password or None, "viewer": self.viewer_password or None},
            "session_secret": self.session_secret,
        }


# ---------------------------------------------------------------- value parsing

def _parse_bool(value, name, problems, default):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("1", "true", "yes", "on"):
        return True
    if isinstance(value, str) and value.strip().lower() in ("0", "false", "no", "off"):
        return False
    problems.append(f"{name}: expected true or false")
    return default


def _parse_host(value, problems):
    text = value.strip() if isinstance(value, str) else ""
    if netaddr.parse_ip(text) is None or "%" in text or text.startswith("["):
        problems.append(f"host: {value!r} is not an IP address; using {DEFAULT_HOST}")
        return DEFAULT_HOST
    return str(netaddr.parse_ip(text)) if ":" not in text else text.lower()


def _parse_port(value, problems):
    try:
        port = int(value) if not isinstance(value, bool) else None
    except (TypeError, ValueError, OverflowError):
        port = None
    if port is None or not 1 <= port <= 65535:
        problems.append(f"port: {value!r} is not a port number; using {DEFAULT_PORT}")
        return DEFAULT_PORT
    if port == DESKTOP_PORT:
        problems.append(f"port: {DESKTOP_PORT} belongs to the desktop app; using {DEFAULT_PORT}")
        return DEFAULT_PORT
    return port


def _parse_tls_mode(value, problems):
    text = value.strip().lower() if isinstance(value, str) else value
    if text not in TLS_MODES:
        problems.append(f"tls: {value!r} is not one of {', '.join(TLS_MODES)}; using off")
        return "off"
    return text


def _parse_file_path(value, name, problems):
    if value in (None, ""):
        return ""
    if not isinstance(value, str) or not os.path.isabs(value):
        problems.append(f"{name}: must be an absolute path")
        return ""
    return os.path.abspath(value)


def _as_list(value, separator):
    if isinstance(value, str):
        return [part for part in (piece.strip() for piece in value.split(separator)) if part]
    if isinstance(value, (list, tuple)):
        return list(value)
    return None


def normalize_root(path):
    """The canonical form of a library root, or None when it isn't an absolute path."""
    if not isinstance(path, str) or not path.strip() or "\0" in path:
        return None
    path = path.strip()
    if not os.path.isabs(path):
        return None
    return os.path.abspath(os.path.normpath(path))


def _parse_roots(value, problems):
    entries = _as_list(value, os.pathsep)
    if entries is None:
        problems.append("library_roots: expected a list of folders")
        return ()
    roots = []
    for entry in entries:
        root = normalize_root(entry)
        if root is None:
            problems.append(f"library_roots: {entry!r} is not an absolute path; skipped")
        elif root not in roots:
            roots.append(root)
    return tuple(roots)


def _parse_names(value, problems):
    entries = _as_list(value, ",")
    if entries is None:
        problems.append("allowed_hosts: expected a list of host names")
        return ()
    names = []
    for entry in entries:
        try:
            names.extend(name for name in netaddr.normalize_host_names([entry]) if name not in names)
        except ValueError as e:
            problems.append(f"allowed_hosts: {e}; skipped")
    return tuple(names)


def _parse_proxies(value, problems):
    entries = _as_list(value, ",")
    if entries is None:
        problems.append("trusted_proxies: expected a list of addresses")
        return ()
    kept = []
    for entry in entries:
        try:
            netaddr.parse_networks([entry])
        except ValueError as e:
            problems.append(f"trusted_proxies: {e}; skipped")
            continue
        kept.append(str(entry).strip())
    return tuple(kept)


def _parse_grants(value, problems):
    grants = {name for name, on in VIEWER_PERMISSIONS.items() if on}
    if value is None:
        return frozenset(grants)
    if not isinstance(value, dict):
        problems.append("viewer_permissions: expected an object")
        return frozenset(grants)
    for name, on in value.items():
        if name not in VIEWER_PERMISSIONS:
            problems.append(f"viewer_permissions: unknown permission {name!r}; ignored")
        elif _parse_bool(on, f"viewer_permissions.{name}", problems, VIEWER_PERMISSIONS[name]):
            grants.add(name)
        else:
            grants.discard(name)
    return frozenset(grants)


def _parse_password(value, role, problems):
    if value in (None, ""):
        return ""
    if not passwords.is_password_hash(value):
        problems.append(f"passwords.{role}: not a stored password; the role has no password until it is set again")
        return ""
    return value


def config_from_json(data) -> ServerConfig:
    """A ServerConfig from the file's JSON. Bad fields fall back to their defaults, which are the
    closed choices, and are listed in problems."""
    problems = []
    if not isinstance(data, dict):
        return ServerConfig(problems=("the file does not hold a JSON object",))
    tls = data.get("tls") if isinstance(data.get("tls"), dict) else {}
    pw = data.get("passwords") if isinstance(data.get("passwords"), dict) else {}
    secret = data.get("session_secret")
    if secret not in (None, "") and (not isinstance(secret, str) or len(secret) < 32):
        problems.append("session_secret: too short; a new one is made")
        secret = ""
    config = ServerConfig(
        enabled=_parse_bool(data.get("enabled", False), "enabled", problems, False),
        host=_parse_host(data.get("host", DEFAULT_HOST), problems),
        port=_parse_port(data.get("port", DEFAULT_PORT), problems),
        tls_mode=_parse_tls_mode(tls.get("mode", "off"), problems),
        cert_file=_parse_file_path(tls.get("cert_file", ""), "tls.cert_file", problems),
        key_file=_parse_file_path(tls.get("key_file", ""), "tls.key_file", problems),
        allowed_hosts=_parse_names(data.get("allowed_hosts", []), problems),
        library_roots=_parse_roots(data.get("library_roots", []), problems),
        public_access=_parse_bool(data.get("public_access", False), "public_access", problems, False),
        trusted_proxies=_parse_proxies(data.get("trusted_proxies", []), problems),
        owner_password=_parse_password(pw.get("owner"), "owner", problems),
        viewer_password=_parse_password(pw.get("viewer"), "viewer", problems),
        session_secret=secret or "",
        viewer_grants=_parse_grants(data.get("viewer_permissions"), problems),
    )
    return replace(config, problems=tuple(problems))


def apply_env(config: ServerConfig, env) -> ServerConfig:
    """config with the VBLIS_SERVER_* overrides from env applied. A bad value is listed in
    problems and the file's value stays."""
    problems = list(config.problems)
    changes = {}
    for suffix, name in _ENV_FIELDS.items():
        raw = env.get(ENV_PREFIX + suffix)
        if raw is None or raw.strip() == "":
            continue
        local = []
        label = ENV_PREFIX + suffix
        if name == "host":
            value = _parse_host(raw, local)
        elif name == "port":
            value = _parse_port(raw, local)
        elif name == "tls_mode":
            value = _parse_tls_mode(raw, local)
        elif name in ("cert_file", "key_file"):
            value = _parse_file_path(raw.strip(), label, local)
        elif name == "library_roots":
            value = _parse_roots(raw, local)
        elif name == "allowed_hosts":
            value = _parse_names(raw, local)
        elif name == "public_access":
            value = _parse_bool(raw, label, local, config.public_access)
        else:
            value = _parse_proxies(raw, local)
        if local:
            problems.extend(f"{label}: {message}" for message in local)
            continue
        changes[name] = value
    if not changes and len(problems) == len(config.problems):
        return config
    return replace(config, problems=tuple(problems), env_fields=frozenset(changes), **changes)


# ---------------------------------------------------------------- checks before starting

def start_problems(config: ServerConfig) -> list:
    """(code, message) pairs that stop the listener from starting."""
    found = []
    if config.load_error:
        found.append(("config_unreadable", config.load_error))
        return found
    if not config.owner_password:
        found.append(("no_owner_password", "Set an owner password first."))
    if config.tls_mode == "files":
        for label, path in (("certificate", config.cert_file), ("key", config.key_file)):
            if not path:
                found.append(("tls_file_missing", f"HTTPS with your own files needs the {label} file."))
            elif not os.path.isfile(path):
                found.append(("tls_file_missing", f"The {label} file doesn't exist: {path}"))
    if config.public_access and not config.secure and not config.trusted_proxies:
        found.append((
            "public_needs_https",
            "Access from the internet needs HTTPS, here or in a trusted proxy in front of VBLIS.",
        ))
    return found


# ---------------------------------------------------------------- the store

def _default_path():
    return paths.DATA_DIR / CONFIG_FILE_NAME


class ServerConfigStore:
    """Loads server.json, applies the environment overrides, and writes changes atomically. The
    file is read again when it changes on disk (a password set from the command line while the
    server runs), at most once a second."""

    def __init__(self, path=None, env=None):
        self._path = str(path or _default_path())
        self._env = ENV_SNAPSHOT if env is None else env
        self._lock = threading.RLock()
        self._config = None
        self._signature = None
        self._checked_at = 0.0
        self._file_lock_depth = 0

    @property
    def path(self) -> str:
        return self._path

    def _file_signature(self):
        try:
            stat = os.stat(self._path)
        except FileNotFoundError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _read(self):
        signature = self._file_signature()
        if signature is None:
            base = ServerConfig()
        else:
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    base = config_from_json(json.load(f))
            except Exception as e:  # noqa: BLE001 - whatever is in the file, the backend must still start
                base = ServerConfig(load_error=f"{self._path} can't be read ({e.__class__.__name__}: {e})")
        self._config = apply_env(base, self._env)
        self._signature = signature
        self._checked_at = time.monotonic()
        return self._config

    def current(self) -> ServerConfig:
        with self._lock:
            if self._config is None:
                return self._read()
            if time.monotonic() - self._checked_at >= _RELOAD_INTERVAL:
                self._checked_at = time.monotonic()
                if self._file_signature() != self._signature:
                    return self._read()
            return self._config

    def reload(self) -> ServerConfig:
        with self._lock:
            return self._read()

    def _stored(self) -> ServerConfig:
        """The file's own values, without the environment overrides, for writing back."""
        signature = self._file_signature()
        if signature is None:
            return ServerConfig()
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                return config_from_json(json.load(f))
        except Exception as e:  # noqa: BLE001 - never overwrite a file that can't be read
            raise ServerConfigError(f"{self._path} can't be read, so it is not changed ({e})") from e

    def stored(self) -> ServerConfig:
        with self._lock:
            return self._stored()

    @contextlib.contextmanager
    def _changing(self):
        """Held around every read-change-write: this process's lock and a lock file, so a command
        run in a terminal and the running server can't overwrite each other's change."""
        with self._lock:
            if self._file_lock_depth:
                self._file_lock_depth += 1
                try:
                    yield
                finally:
                    self._file_lock_depth -= 1
                return
            directory = os.path.dirname(os.path.abspath(self._path))
            os.makedirs(directory, exist_ok=True)
            fd = os.open(self._path + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
            try:
                deadline = time.monotonic() + _LOCK_TIMEOUT
                while True:
                    try:
                        paths._lock_fd(fd)
                        break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise ServerConfigError(f"{self._path} is being changed by another program; try again")
                        time.sleep(0.05)
                self._file_lock_depth = 1
                try:
                    yield
                finally:
                    self._file_lock_depth = 0
                    paths._unlock_fd(fd)
            finally:
                os.close(fd)

    def _write(self, config: ServerConfig) -> None:
        directory = os.path.dirname(os.path.abspath(self._path))
        os.makedirs(directory, exist_ok=True)
        # mkstemp creates the file readable by its owner only, and os.replace keeps that mode
        fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".server.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                json.dump(config.to_json(), f, indent=2, ensure_ascii=False)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())  # an empty file after a power cut would keep the server from starting
            os.replace(tmp_path, self._path)
        except BaseException:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise

    def update(self, **changes) -> ServerConfig:
        """Write the given fields and return the new effective config. Raises ServerConfigError
        when the file exists but can't be read."""
        with self._changing():
            stored = self._stored()
            not_stored = (set(changes) - set(ServerConfig.__dataclass_fields__)) | (
                {"env_fields", "problems", "load_error"} & set(changes)
            )
            if not_stored:
                raise ValueError(f"not a stored setting: {sorted(not_stored)}")
            updated = replace(stored, problems=(), **changes)
            if not updated.session_secret:
                updated = replace(updated, session_secret=sessions.new_secret())
            self._write(updated)
            return self._read()

    def ensure_secret(self) -> ServerConfig:
        config = self.current()
        if config.session_secret or config.load_error:
            return config
        return self.update()

    def rotate_secret(self) -> ServerConfig:
        """A new session secret: every signed-in browser has to sign in again."""
        return self.update(session_secret=sessions.new_secret())

    def set_password(self, role: str, password: str):
        """(config, None) when stored, or (None, code). Codes: unknown_role, empty, too_short,
        too_long, same_as_other (owner and viewer must differ)."""
        if role not in sessions.ROLES:
            return None, "unknown_role"
        problem = passwords.password_problem(password)
        if problem:
            return None, problem
        with self._changing():
            stored = self._stored()
            other = stored.viewer_password if role == "owner" else stored.owner_password
            if other and passwords.verify_password(password, other):
                return None, "same_as_other"
            field_name = "owner_password" if role == "owner" else "viewer_password"
            return self.update(**{field_name: passwords.hash_password(password)}), None

    def clear_password(self, role: str) -> ServerConfig:
        """Remove a role's password, which ends its sessions. Only the viewer's can be removed:
        without an owner password the listener can't start."""
        if role != "viewer":
            raise ValueError("only the viewer password can be removed")
        return self.update(viewer_password="")

    def set_viewer_permission(self, permission: str, granted: bool) -> ServerConfig:
        if permission not in VIEWER_PERMISSIONS:
            raise ValueError(f"unknown permission: {permission}")
        with self._changing():
            grants = set(self._stored().viewer_grants)
            (grants.add if granted else grants.discard)(permission)
            return self.update(viewer_grants=frozenset(grants))
