"""Runs the network listener in the backend's own event loop, next to the desktop listener or alone.

uvicorn needs three adjustments for that:
- The socket is bound here first. uvicorn calls sys.exit() when it can't bind, which would end the
  whole backend, and on Windows a wildcard bind over a port someone holds on loopback succeeds
  quietly unless the socket asks for exclusive use.
- The configuration is loaded here first, so a bad certificate becomes a message.
- Embedded next to the desktop listener, it must not touch signal handlers or logging, which
  belong to the desktop listener.

With HTTPS on, uvicorn gets the plain socket and tls_redirect looks at each connection first: TLS goes
on to uvicorn, plain HTTP gets a redirect to https:// on the same port."""
import asyncio
import contextlib
import hashlib
import ipaddress
import os
import socket
import ssl
import sys

import uvicorn
from uvicorn.config import LOGGING_CONFIG

import netaddr
import paths
import security
import server_config
import tls_redirect
from confirm_memory import RecentConfirmations
from network_app import build_network_app

STOP_TIMEOUT = 8.0
# Settings baked into a running listener; changing any of them needs a restart. The others (accounts,
# library folders, public access, proxies) are read on every request.
RESTART_FIELDS = ("host", "port", "tls_mode", "cert_file", "key_file", "allowed_hosts")


class _EmbeddedServer(uvicorn.Server):
    @contextlib.contextmanager
    def capture_signals(self):
        yield


def bind_socket(host: str, port: int) -> socket.socket:
    """A listening-ready socket on host:port. Raises OSError when the port is taken."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            # "::" also accepts IPv4 clients
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind((host, port))
        sock.set_inheritable(False)
    except BaseException:
        sock.close()
        raise
    return sock


# Interfaces of containers and virtual machines on a Linux host, by name prefix
_BRIDGE_PREFIXES = ("docker", "br-", "veth", "virbr", "cni", "flannel", "cali", "podman", "lxcbr", "lxdbr")
_LINK_LOCAL = ipaddress.ip_network("169.254.0.0/16")


def _hostname_addresses() -> list:
    """The IPv4 addresses the host name resolves to. On a Linux host with host networking
    (nss-myhostname) that is every interface, Docker's bridges included."""
    try:
        return [info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        return []


def _default_route_address():
    """The address of the interface the default route leaves by, or None without a route."""
    try:
        # A UDP "connect" sends nothing; it only picks the address of the default route
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
    except OSError:
        return None


def _linux_interface_addresses() -> list:
    """[(interface name, IPv4 address)] on Linux, [] anywhere else or when the lookup fails."""
    try:
        import fcntl
        import struct
        names = [name for _, name in socket.if_nameindex()]
        found = []
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            for name in names:
                try:
                    # SIOCGIFADDR; bytes 20:24 of the answer hold the IPv4 address
                    reply = fcntl.ioctl(sock.fileno(), 0x8915, struct.pack("256s", name[:15].encode()))
                except OSError:  # an interface without an IPv4 address
                    continue
                found.append((name, socket.inet_ntoa(reply[20:24])))
        return found
    except (ImportError, OSError, AttributeError, ValueError, UnicodeError):
        return []


def _is_link_local(address: str) -> bool:
    try:
        return ipaddress.ip_address(address) in _LINK_LOCAL
    except ValueError:
        return False


def lan_addresses() -> list:
    """This machine's addresses on private networks, for the URLs to show and the certificate.

    The default-route address comes first, so the first URL shown is the most likely right one, then
    the others sorted. Link-local addresses (169.254.x.x) are left out. On a Linux Docker host with
    host networking the host name resolves to every interface, so on Linux the addresses of container
    and VM bridges (docker0, br-<id>, veth..., virbr0 and the like) are left out too, by interface
    name; the default-route address always stays. Elsewhere nothing is left out by interface name
    (VPN tunnels and virtual machine adapters can be what someone uses). If the interface lookup
    fails, nothing is left out by name."""
    route = _default_route_address()
    found = set(_hostname_addresses())
    if route:
        found.add(route)
    bridges = set()
    if sys.platform.startswith("linux"):
        bridges = {a for name, a in _linux_interface_addresses() if name.startswith(_BRIDGE_PREFIXES)}

    def keep(a):
        return (netaddr.is_private_client(a) and not netaddr.is_loopback_client(a)
                and not _is_link_local(a) and (a == route or a not in bridges))

    rest = sorted(a for a in found if a != route and keep(a))
    return ([route] if route and keep(route) else []) + rest


def _url_host(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def listen_urls(scheme: str, host: str, port: int, allowed_hosts=(), lan=None) -> list:
    """The addresses a browser can open: this machine's LAN addresses when listening on every interface
    (`lan`, else looked up now), else the listen address, then the extra names from allowed_hosts (a name
    in front of a Docker container or a proxy)."""
    if host in ("0.0.0.0", "::"):
        hosts = list(lan_addresses() if lan is None else lan) or ["localhost"]
    else:
        hosts = [host]
    hosts += [name for name in allowed_hosts if name not in hosts]
    return [f"{scheme}://{_url_host(h)}:{port}/" for h in hosts]


def self_signed_cert_file():
    """Where the self-signed certificate is kept, also while sharing is off."""
    return paths.DATA_DIR / "tls" / "cert.pem"


def cert_fingerprint(cert_file) -> str:
    """SHA-256 of the first certificate in a PEM file, as AA:BB:..., or "" when unreadable."""
    try:
        with open(cert_file, "r", encoding="ascii", errors="replace") as f:
            der = ssl.PEM_cert_to_DER_cert(f.read())
    except (OSError, ValueError):
        return ""
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))


class NetworkListener:
    """require_owner=False when the desktop app shares: it is the owner itself, so viewer accounts alone
    are enough. The command-line server keeps requiring an owner account.

    start, stop and restart take one lock, so two changes from the desktop app at once can't leave two
    servers or none. The lock belongs to the event loop that runs the listener (one per process; tests
    run each app in a loop of its own)."""

    def __init__(self, store, web_dir=None, embedded=True, log=print, hostname=None, require_owner=True):
        self.store = store
        self.web_dir = web_dir
        self.embedded = embedded
        self.log = log
        self.hostname = hostname
        self.require_owner = require_owner
        self._server = None
        self._task = None
        self._gate = None
        self._router = None  # tls_redirect.TlsRouter while HTTPS runs
        self._info = {}
        self._started_with = None  # the RESTART_FIELDS values the running listener uses
        self._lock = None
        self._lock_loop = None
        self.problems = []

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict:
        info = dict(self._info) if self.running else {}
        return {"running": self.running, "problems": [list(p) for p in self.problems], **info}

    def needs_restart(self, config) -> bool:
        """Whether `config` differs from the running listener in a setting baked in at start."""
        return self._started_with != tuple(getattr(config, name) for name in RESTART_FIELDS)

    def forget_confirmations(self, account_id=None) -> None:
        """Forget remembered password confirmations: of one account, or all of them."""
        gate = self._gate
        if gate is None:
            return
        if account_id is None:
            gate.confirmations.clear()
        else:
            gate.confirmations.forget(account_id)

    def _guard(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        return self._lock

    def _tls(self, config):
        """(certificate, key, problems) for the configured HTTPS mode. Blocking (address lookups,
        certificate creation): run it in a thread."""
        if config.tls_mode == "off":
            return None, None, []
        if config.tls_mode == "files":
            return config.cert_file, config.key_file, []
        try:
            import tls_selfsigned
        except ImportError:
            return None, None, [("tls_unavailable", "Self-signed HTTPS needs the 'cryptography' package.")]
        names = {socket.gethostname().lower(), "localhost"}
        addresses = lan_addresses() + ["127.0.0.1"]
        if config.host not in ("0.0.0.0", "::") and netaddr.parse_ip(config.host) is not None:
            addresses.append(config.host)
        # Names given in allowed_hosts (Docker, a name on the LAN) belong in the certificate too
        for entry in config.allowed_hosts:
            if netaddr.parse_ip(entry) is not None:
                addresses.append(entry)
            else:
                names.add(entry)
        try:
            cert, key = tls_selfsigned.ensure_certificate(paths.DATA_DIR / "tls", sorted(names), sorted(set(addresses)))
        except Exception as e:  # noqa: BLE001 - any failure here is reported, not raised
            return None, None, [("tls_failed", f"Couldn't create the self-signed certificate: {e}")]
        return str(cert), str(key), []

    async def start(self, config=None) -> list:
        """Start listening, with `config` (an effective ServerConfig) or the stored settings. Returns the
        (code, message) problems that stopped it, or []. Does nothing while running."""
        async with self._guard():
            return await self._start(config)

    async def stop(self) -> None:
        async with self._guard():
            await self._stop()

    async def restart(self, config=None) -> list:
        """Stop, then start with `config` or the stored settings. Returns the problems, or []."""
        async with self._guard():
            await self._stop()
            return await self._start(config)

    def summary(self) -> dict:
        """For the desktop app's title bar: whether it shares, and why not when it should."""
        running = self.running
        problems = self.problems  # one read: apply() replaces the list from the event loop
        problem = problems[0][0] if (not running and problems) else None
        return {"running": running, "problem": problem}

    async def apply(self, prepare, stop_first=False) -> tuple:
        """Apply a settings change and bring the listener in line with it. Returns (problems, saved).

        `prepare()` (blocking, run in a thread under the listener's lock, so two changes can't interleave)
        reads the settings and returns (candidate, previous, save): the effective settings after and before
        the change, and save(include_enabled=True), which writes it. It raises to refuse the change.
        stop_first: turning sharing off stops the listener before anything else, so it stops even when the
        settings can't be read or saved.

        Sharing off: stop. On: start, or restart when a setting baked in at start changed; save() runs only
        when that worked. When starting fails:
        - a listener that ran before runs on as it was, and nothing is saved;
        - one that wasn't running has nothing to keep: the change is saved except turning sharing on, so an
          edit made while sharing can't start (a library folder removed) isn't lost."""
        async with self._guard():
            if stop_first:
                await self._stop()
            candidate, previous, save = await asyncio.to_thread(prepare)
            was_running = self.running
            if not candidate.enabled:
                await self._stop()
                await asyncio.to_thread(save)
                return [], True
            if was_running and not self.needs_restart(candidate):
                await asyncio.to_thread(save)
                return [], True
            await self._stop()
            failed = await self._start(candidate)
            if not failed:
                try:
                    await asyncio.to_thread(save)
                except BaseException:
                    await self._stop()
                    if was_running:
                        await self._start()
                    raise
                return [], True
            failed = list(failed)
            if was_running:
                await self._start()  # the stored settings, which this change didn't touch
                return failed, False
            await asyncio.to_thread(save, False)
            # Keep the reason only while the settings still say "share" (it failed at app start too)
            self.problems = failed if previous.enabled else []
            return failed, True

    async def _start(self, config=None) -> list:
        if self.running:
            return []
        self.problems = []
        if config is None:
            try:
                config = await asyncio.to_thread(self.store.ensure_secret)
            except server_config.ServerConfigError as e:
                self.problems = [("config_unreadable", str(e))]
                return self.problems
            except OSError as e:
                self.problems = [("config_unwritable", f"Can't write {self.store.path}: {e}")]
                return self.problems
        problems = server_config.start_problems(config, require_owner=self.require_owner)
        if not problems and not config.session_secret:
            problems = [("config_unreadable", "The settings have no session secret yet.")]
        cert, key, tls_problems = (await asyncio.to_thread(self._tls, config)) if not problems else (None, None, [])
        problems = problems + tls_problems
        if problems:
            self.problems = problems
            return problems

        gate = build_network_app(self.store, web_dir=self.web_dir, port=config.port,
                                 hostname=self.hostname, log=self.log, require_owner=self.require_owner,
                                 confirmations=RecentConfirmations())
        try:
            sock = bind_socket(config.host, config.port)
        except OSError as e:
            self.problems = [("port_in_use", f"Can't listen on {config.host}:{config.port}: {e.strerror or e}")]
            return self.problems

        uv_config = uvicorn.Config(
            gate,
            host=config.host,
            port=config.port,
            lifespan="off",
            proxy_headers=False,
            server_header=False,
            date_header=True,
            ws="none",
            # Embedded, the desktop listener already set up logging; alone, this one does it
            log_config=None if self.embedded else LOGGING_CONFIG,
            timeout_graceful_shutdown=3,
            limit_concurrency=100,
            ssl_certfile=cert,
            ssl_keyfile=key,
        )
        try:
            uv_config.load()
        except Exception as e:  # noqa: BLE001 - a bad certificate or key lands here
            sock.close()
            self.problems = [("tls_invalid", f"The certificate or key can't be used: {e}")]
            return self.problems
        router = None
        if cert:
            # uvicorn gets the plain socket: TLS connections are handed on to it, plain HTTP is redirected
            router = tls_redirect.TlsRouter(uv_config.ssl, gate.allowed_host_names)
            uv_config.http_protocol_class = router.protocol_factory(uv_config.http_protocol_class)
            uv_config.ssl = None

        security.redact_paths_in_access_log(True)
        security.install_access_log_redaction()  # again: a standalone Config just reset the loggers
        server_class = _EmbeddedServer if self.embedded else uvicorn.Server
        self._server = server_class(uv_config)
        self._task = asyncio.get_running_loop().create_task(self._server.serve(sockets=[sock]))
        for _ in range(200):
            if self._server.started or self._task.done():
                break
            await asyncio.sleep(0.025)
        if self._task.done():
            error = self._task.exception()
            self.problems = [("start_failed", f"The listener stopped at once: {error!r}")]
            self._task = None
            sock.close()
            return self.problems

        scheme = "https" if cert else "http"
        lan = await asyncio.to_thread(lan_addresses) if config.host in ("0.0.0.0", "::") else []
        urls = listen_urls(scheme, config.host, config.port, config.allowed_hosts, lan=lan)
        self._gate = gate
        self._router = router
        self._started_with = tuple(getattr(config, name) for name in RESTART_FIELDS)
        self._info = {
            "scheme": scheme,
            "port": config.port,
            "urls": urls,
            "fingerprint": cert_fingerprint(cert) if cert else "",
        }
        for url in urls:
            self.log(f"[Network] Serving VBLIS on {url}")
        if scheme == "http":
            self.log("[Network] Plain HTTP: pictures and sign-ins travel unencrypted. See SERVER.md for HTTPS.")
        if self._info["fingerprint"]:
            self.log(f"[Network] Certificate fingerprint (SHA-256): {self._info['fingerprint']}")
        return []

    async def wait(self) -> None:
        """Until the listener stops on its own."""
        if self._task is not None:
            with contextlib.suppress(Exception):
                await asyncio.shield(self._task)

    async def _stop(self) -> None:
        task, server, router = self._task, self._server, self._router
        self._task = None
        self._gate = None
        self._router = None
        self._started_with = None
        self.problems = []
        if router is not None:
            # First: connections uvicorn doesn't know about yet (no first bytes, or mid-handshake) can't
            # slip in after its shutdown went through its own connections
            router.close()
        if task is None or server is None:
            return
        server.should_exit = True
        done, _ = await asyncio.wait({task}, timeout=STOP_TIMEOUT)
        if not done:
            server.force_exit = True
            await asyncio.wait({task}, timeout=STOP_TIMEOUT)
        self.log("[Network] Stopped listening")
