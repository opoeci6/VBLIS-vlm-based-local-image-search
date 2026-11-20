"""Settings of the network listener, kept in <data>/data/server.json.

The file holds the accounts (with their password hashes) and the session secret, so it is written atomically and, on
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

import accounts as acct
import netaddr
import path_keys
import paths
import sessions

CONFIG_FILE_NAME = "server.json"
# 2: named accounts. Version 1 (part 1 of server mode, never released) had one password per role.
FILE_VERSION = 2
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DESKTOP_PORT = 8000
TLS_MODES = ("off", "files", "self_signed")
# Viewer permissions the owner can grant per account, with the defaults of a new viewer
VIEWER_PERMISSIONS = acct.PERMISSIONS

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
    "LOCAL_NETWORKS": "local_networks",
}
MAX_LOCAL_NETWORKS = 64
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
    # Addresses or ranges whose clients count as local besides the private ones (netaddr.parse_local_networks)
    local_networks: tuple = ()
    accounts: tuple = ()  # of accounts.Account
    session_secret: str = ""
    # Not stored: what loading found
    env_fields: frozenset = frozenset()
    problems: tuple = ()
    load_error: str = ""

    def account_by_id(self, account_id):
        return acct.find(self.accounts, account_id)

    def account_by_name(self, name):
        return acct.find_by_name(self.accounts, name)

    @property
    def has_owner(self) -> bool:
        """An owner account that can sign in exists; the command-line server doesn't start without one."""
        return acct.has_active_owner(self.accounts)

    @property
    def has_sign_in(self) -> bool:
        """Any account can sign in; sharing from the desktop app doesn't start without one."""
        return acct.can_sign_in_count(self.accounts) > 0

    def account_counts(self) -> dict:
        return {
            "owners": sum(1 for account in self.accounts if account.is_owner),
            "viewers": sum(1 for account in self.accounts if not account.is_owner),
            "can_sign_in": acct.can_sign_in_count(self.accounts),
        }

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
            "local_networks": list(self.local_networks),
            "accounts": [account.to_json() for account in self.accounts],
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
    """The canonical form of a library root, or None when it isn't an absolute path (or can't be written
    as UTF-8, like a Linux name that isn't valid UTF-8: it couldn't be saved or indexed)."""
    if not isinstance(path, str) or not path.strip() or "\0" in path or not path_keys.is_valid_name(path):
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


def _parse_local_networks(value, problems):
    entries = _as_list(value, ",")
    if entries is None:
        problems.append("local_networks: expected a list of addresses or ranges")
        return ()
    kept, seen = [], set()
    for entry in entries:
        try:
            network = netaddr.parse_local_networks([entry])[0]
        except ValueError as e:
            problems.append(f"local_networks: {e}; skipped")
            continue
        if network in seen:
            continue
        if len(kept) == MAX_LOCAL_NETWORKS:
            problems.append(f"local_networks: more than {MAX_LOCAL_NETWORKS}; the rest skipped")
            break
        seen.add(network)
        kept.append(str(entry).strip())
    return tuple(kept)


def config_from_json(data) -> ServerConfig:
    """A ServerConfig from the file's JSON. Bad fields fall back to their defaults, which are the
    closed choices, and are listed in problems."""
    problems = []
    if not isinstance(data, dict):
        return ServerConfig(problems=("the file does not hold a JSON object",))
    tls = data.get("tls") if isinstance(data.get("tls"), dict) else {}
    old_passwords = data.get("passwords")
    if isinstance(old_passwords, dict) and any(old_passwords.values()):
        # Version 1 (an unreleased test version) had one password per role; they aren't carried over
        problems.append("passwords: from an earlier test version and no longer used; add accounts with add-account")
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
        local_networks=_parse_local_networks(data.get("local_networks", []), problems),
        accounts=acct.parse_accounts(data.get("accounts"), problems),
        session_secret=secret or "",
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
        elif name == "trusted_proxies":
            value = _parse_proxies(raw, local)
        else:
            value = _parse_local_networks(raw, local)
        if local:
            problems.extend(f"{label}: {message}" for message in local)
            continue
        changes[name] = value
    if not changes and len(problems) == len(config.problems):
        return config
    return replace(config, problems=tuple(problems), env_fields=frozenset(changes), **changes)


# ---------------------------------------------------------------- checks before starting

def start_problems(config: ServerConfig, require_owner=True) -> list:
    """(code, message) pairs that stop the listener from starting. require_owner=False is for sharing
    from the desktop app, which is the owner itself: then any account that can sign in is enough."""
    found = []
    if config.load_error:
        found.append(("config_unreadable", config.load_error))
        return found
    if require_owner and not config.has_owner:
        found.append(("no_owner_account", "Add an owner account first: add-account NAME --role owner"))
    elif not require_owner and not config.has_sign_in:
        found.append(("no_accounts", "Add an account first, so someone can sign in."))
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


# ---------------------------------------------------------------- changes from the desktop app

class InvalidSetting(ValueError):
    """A changed setting that doesn't pass the file's own checks; nothing is written."""

    def __init__(self, problems):
        super().__init__("; ".join(problems))
        self.problems = tuple(problems)


# Changeable settings and where they sit in the file's JSON
_JSON_PLACES = {
    "enabled": ("enabled",),
    "host": ("host",),
    "port": ("port",),
    "tls_mode": ("tls", "mode"),
    "cert_file": ("tls", "cert_file"),
    "key_file": ("tls", "key_file"),
    "allowed_hosts": ("allowed_hosts",),
    "library_roots": ("library_roots",),
    "public_access": ("public_access",),
    "trusted_proxies": ("trusted_proxies",),
    "local_networks": ("local_networks",),
}


def validated_changes(stored: ServerConfig, **changes) -> ServerConfig:
    """`stored` (the file's own values) with `changes` applied, checked the way the file is checked when
    it is read. A file read falls back to a default for a bad value; a change is refused instead
    (InvalidSetting), so nobody gets a different setting than the one they chose."""
    unknown = set(changes) - set(_JSON_PLACES)
    if unknown:
        raise ValueError(f"not a changeable setting: {sorted(unknown)}")
    data = stored.to_json()
    before = set(config_from_json(data).problems)
    for name, value in changes.items():
        place = _JSON_PLACES[name]
        if isinstance(value, tuple):
            value = list(value)
        if len(place) == 2:
            data[place[0]] = {**data[place[0]], place[1]: value}
        else:
            data[place[0]] = value
    updated = config_from_json(data)
    new_problems = [problem for problem in updated.problems if problem not in before]
    if new_problems:
        # "...; using 8080" describes what reading the file does; here the change is refused instead
        raise InvalidSetting([problem.split("; using ")[0].split("; skipped")[0] for problem in new_problems])
    return replace(updated, problems=())


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

    def with_env(self, config: ServerConfig) -> ServerConfig:
        """`config` (file values) as it would take effect here, with this store's environment overrides."""
        return apply_env(config, self._env)

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

    # Account changes: read the stored accounts, apply one rule-checked change (accounts.py), write, all
    # under the lock. They raise accounts.AccountError when a rule is broken, ServerConfigError when the
    # file can't be read. A new password is hashed before the lock is taken: the network listener reads
    # the config under the same lock on every request.

    def add_account(self, name, role, password, permissions=None):
        """(config, the new account)."""
        password_hash = acct.hash_new_password(password)
        with self._changing():
            changed, account = acct.add(self._stored().accounts, name, role, password_hash, permissions)
            return self.update(accounts=changed), account

    def update_account(self, account_id, name=None, role=None, permissions=None, disabled=None,
                       acting_id=None, keep_owner=True) -> ServerConfig:
        with self._changing():
            changed = acct.update(self._stored().accounts, account_id, name=name, role=role,
                                  permissions=permissions, disabled=disabled, acting_id=acting_id,
                                  keep_owner=keep_owner)
            return self.update(accounts=changed)

    def set_account_password(self, account_id, password) -> ServerConfig:
        password_hash = acct.hash_new_password(password)
        with self._changing():
            return self.update(accounts=acct.set_password(self._stored().accounts, account_id, password_hash))

    def sign_out_account(self, account_id) -> ServerConfig:
        """A new session salt: that account has to sign in again everywhere."""
        with self._changing():
            return self.update(accounts=acct.sign_out(self._stored().accounts, account_id))

    def remove_account(self, account_id, acting_id=None, keep_owner=True) -> ServerConfig:
        with self._changing():
            return self.update(accounts=acct.remove(self._stored().accounts, account_id, acting_id=acting_id,
                                                    keep_owner=keep_owner))
