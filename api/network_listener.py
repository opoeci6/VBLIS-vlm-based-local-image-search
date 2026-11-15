"""Runs the network listener in the backend's own event loop, next to the desktop listener or alone.

uvicorn needs three adjustments for that:
- The socket is bound here first. uvicorn calls sys.exit() when it can't bind, which would end the
  whole backend, and on Windows a wildcard bind over a port someone holds on loopback succeeds
  quietly unless the socket asks for exclusive use.
- The configuration is loaded here first, so a bad certificate becomes a message.
- Embedded next to the desktop listener, it must not touch signal handlers or logging, which
  belong to the desktop listener."""
import asyncio
import contextlib
import hashlib
import os
import socket
import ssl

import uvicorn
from uvicorn.config import LOGGING_CONFIG

import netaddr
import paths
import security
import server_config
from network_app import build_network_app

STOP_TIMEOUT = 8.0


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


def lan_addresses() -> list:
    """This machine's addresses on private networks, for the URLs to show."""
    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    try:
        # A UDP "connect" sends nothing; it only picks the address of the default route
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            found.add(probe.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in found if netaddr.is_private_client(a) and not netaddr.is_loopback_client(a))


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
    def __init__(self, store, web_dir=None, embedded=True, log=print, hostname=None):
        self.store = store
        self.web_dir = web_dir
        self.embedded = embedded
        self.log = log
        self.hostname = hostname
        self._server = None
        self._task = None
        self._info = {}
        self.problems = []

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict:
        info = dict(self._info) if self.running else {}
        return {"running": self.running, "problems": [list(p) for p in self.problems], **info}

    def _tls(self, config):
        """(certificate, key, problems) for the configured HTTPS mode."""
        if config.tls_mode == "off":
            return None, None, []
        if config.tls_mode == "files":
            return config.cert_file, config.key_file, []
        try:
            import tls_selfsigned
        except ImportError:
            return None, None, [("tls_unavailable", "Self-signed HTTPS needs the 'cryptography' package.")]
        names = sorted({socket.gethostname().lower(), "localhost"})
        addresses = lan_addresses() + ["127.0.0.1"]
        if config.host not in ("0.0.0.0", "::") and netaddr.parse_ip(config.host) is not None:
            addresses.append(config.host)
        try:
            cert, key = tls_selfsigned.ensure_certificate(paths.DATA_DIR / "tls", names, sorted(set(addresses)))
        except Exception as e:  # noqa: BLE001 - any failure here is reported, not raised
            return None, None, [("tls_failed", f"Couldn't create the self-signed certificate: {e}")]
        return str(cert), str(key), []

    async def start(self) -> list:
        """Start listening. Returns the (code, message) problems that stopped it, or []."""
        if self.running:
            return []
        self.problems = []
        try:
            config = self.store.ensure_secret()
        except server_config.ServerConfigError as e:
            self.problems = [("config_unreadable", str(e))]
            return self.problems
        except OSError as e:
            self.problems = [("config_unwritable", f"Can't write {self.store.path}: {e}")]
            return self.problems
        problems = server_config.start_problems(config)
        cert, key, tls_problems = self._tls(config) if not problems else (None, None, [])
        problems = problems + tls_problems
        if problems:
            self.problems = problems
            return problems

        gate = build_network_app(self.store, web_dir=self.web_dir, port=config.port,
                                 hostname=self.hostname, log=self.log)
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
        if config.host in ("0.0.0.0", "::"):
            hosts = lan_addresses() or ["localhost"]
        else:
            hosts = [config.host]
        urls = [f"{scheme}://{h if ':' not in h else '[' + h + ']'}:{config.port}/" for h in hosts]
        self._info = {
            "scheme": scheme,
            "port": config.port,
            "urls": urls,
            "fingerprint": cert_fingerprint(cert) if cert else "",
        }
        for url in urls:
            self.log(f"[Network] Serving VBLIS on {url}")
        if scheme == "http":
            self.log("[Network] Plain HTTP: passwords and pictures travel unencrypted. See SERVER.md for HTTPS.")
        if self._info["fingerprint"]:
            self.log(f"[Network] Certificate fingerprint (SHA-256): {self._info['fingerprint']}")
        return []

    async def wait(self) -> None:
        """Until the listener stops on its own."""
        if self._task is not None:
            with contextlib.suppress(Exception):
                await asyncio.shield(self._task)

    async def stop(self) -> None:
        task, server = self._task, self._server
        self._task = None
        if task is None or server is None:
            return
        server.should_exit = True
        done, _ = await asyncio.wait({task}, timeout=STOP_TIMEOUT)
        if not done:
            server.force_exit = True
            await asyncio.wait({task}, timeout=STOP_TIMEOUT)
        self.log("[Network] Stopped listening")
