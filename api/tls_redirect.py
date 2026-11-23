"""Plain HTTP on the HTTPS port: answered with a redirect to https:// on the same port.

Someone who types http://<address>:8080 for a server that speaks HTTPS on 8080 would otherwise get a
broken connection. So when HTTPS is on, each new connection is looked at before anything else reads it:

- A TLS connection starts with a handshake record (first byte 0x16). It is handed to TLS and then to
  uvicorn's own HTTP protocol, as when uvicorn wraps the socket itself: the same steps as asyncio's
  loop.start_tls, plus the bytes already read.
- Anything else gets one short answer and the connection is closed: 307 Temporary Redirect to
  https://<host><path> when the Host header passes the same check as the network gate (an address, the
  machine's own names, allowed_hosts) and the request line is clean; 400 otherwise. The location is
  built from the parsed host, never copied from the header.

307, not 301 or 308: browsers don't remember it, so turning HTTPS off later doesn't leave http:// links
broken. No HSTS for the same reason: a self-signed certificate must stay something a browser lets you
continue past.

Connections that never send anything are closed after FIRST_BYTES_TIMEOUT, and at most MAX_WAITING may
wait at once; uvicorn's own limits apply once a connection is handed over."""
import asyncio
from asyncio import sslproto

import netaddr

TLS_HANDSHAKE = 0x16
HEAD_LIMIT = 8192
FIRST_BYTES_TIMEOUT = 10.0
MAX_WAITING = 256
_TARGET_MAX = 2048
_METHODS = (b"GET", b"HEAD", b"POST", b"PUT", b"PATCH", b"DELETE", b"OPTIONS")


class TlsRouter:
    """One per listener start. protocol_factory() wraps uvicorn's HTTP protocol class. close() is called
    when the listener stops, before uvicorn: it refuses new connections and closes the ones still waiting
    for their first bytes or still in the TLS handshake, which uvicorn doesn't know about yet."""

    def __init__(self, ssl_context, allowed_names, timeout=FIRST_BYTES_TIMEOUT, max_waiting=MAX_WAITING):
        self.ssl_context = ssl_context
        self.allowed_names = allowed_names  # () -> the host names the gate accepts besides addresses
        self.timeout = timeout
        self.max_waiting = max_waiting
        self.waiting = set()  # FirstBytes protocols
        self.handshaking = set()  # transports handed to TLS whose handshake hasn't ended
        self.closing = False

    def protocol_factory(self, http_protocol_class):
        """What uvicorn calls for each connection, as config.http_protocol_class(config=..., ...)."""

        def create(**kwargs):
            return FirstBytes(self, http_protocol_class, kwargs)

        return create

    def close(self) -> None:
        self.closing = True
        for protocol in list(self.waiting):
            protocol.abort()
        for transport in list(self.handshaking):
            transport.abort()
        self.handshaking.clear()


def _feed(protocol, data: bytes) -> None:
    """Give `data` to a BufferedProtocol (asyncio's SSLProtocol) as if the transport had read it."""
    view = memoryview(data)
    while view:
        buffer = protocol.get_buffer(len(view))
        count = min(len(buffer), len(view))
        if count == 0:
            raise RuntimeError("the protocol gave no buffer")
        buffer[:count] = view[:count]
        protocol.buffer_updated(count)
        view = view[count:]


def _ignore_result(future) -> None:
    # A failed handshake (a client that hangs up, a scanner) ends the connection; nothing to report
    if not future.cancelled():
        future.exception()


def _response(status: str, headers, body: bytes, with_body=True) -> bytes:
    lines = [f"HTTP/1.1 {status}", *headers, "Content-Type: text/plain; charset=utf-8",
             f"Content-Length: {len(body)}", "Cache-Control: no-store", "X-Content-Type-Options: nosniff",
             "Connection: close", "", ""]
    return "\r\n".join(lines).encode("ascii") + (body if with_body else b"")


def redirect_location(head: bytes, allowed_names, local_port):
    """(method, the https:// location) for a plain HTTP request head, or (method, None) when it is
    malformed or names a host the gate wouldn't accept."""
    lines = head.split(b"\r\n")
    parts = lines[0].split(b" ")
    method = parts[0] if parts else b""
    if len(parts) != 3 or method not in _METHODS or parts[2] not in (b"HTTP/1.0", b"HTTP/1.1"):
        return method, None
    try:
        target = parts[1].decode("ascii")
    except UnicodeDecodeError:
        return method, None
    if (not target.startswith("/") or target.startswith("//") or len(target) > _TARGET_MAX
            or any(ord(ch) <= 0x20 or ord(ch) == 0x7F or ch == "\\" for ch in target)):
        return method, None
    hosts = [line.split(b":", 1)[1] for line in lines[1:] if line[:5].lower() == b"host:"]
    if len(hosts) != 1:
        return method, None
    try:
        header = hosts[0].decode("ascii").strip()
    except UnicodeDecodeError:
        return method, None
    if not netaddr.host_allowed(header, allowed_names):
        return method, None
    name, port = netaddr.split_host(header)
    address = netaddr.parse_ip(name)
    if address is not None:
        # Written out from the parsed address: no zone, nothing else that was inside the brackets
        host = f"[{address.compressed}]" if address.version == 6 else address.compressed
    else:
        host = name  # split_host lets only host-name characters through
    port = port or local_port
    if port and port != 443:
        host = f"{host}:{port}"
    location = f"https://{host}{target}"
    if any(ord(ch) <= 0x20 or ord(ch) >= 0x7F for ch in location):
        return method, None
    return method, location


class FirstBytes(asyncio.Protocol):
    """Waits for a connection's first bytes, then hands it to TLS or answers it as plain HTTP."""

    def __init__(self, router: TlsRouter, http_protocol_class, kwargs):
        self.router = router
        self.http_protocol_class = http_protocol_class
        self.kwargs = kwargs
        self.transport = None
        self.buffer = bytearray()
        self.timer = None
        self.done = False

    def connection_made(self, transport):
        self.transport = transport
        if self.router.closing or len(self.router.waiting) >= self.router.max_waiting:
            self.done = True
            transport.abort()
            return
        self.router.waiting.add(self)
        self.timer = asyncio.get_running_loop().call_later(self.router.timeout, self.abort)

    def data_received(self, data):
        if self.done:
            return
        if not self.buffer and data[:1] == bytes((TLS_HANDSHAKE,)):
            self._hand_to_tls(bytes(data))
            return
        self.buffer += data
        end = self.buffer.find(b"\r\n\r\n")
        if end != -1:
            self._answer(bytes(self.buffer[:end]))
        elif len(self.buffer) > HEAD_LIMIT:
            self._send(_response("400 Bad Request", [], b"Bad request.\n"))

    def eof_received(self):
        self.abort()
        return False

    def connection_lost(self, exc):
        self._finish()

    def abort(self) -> None:
        self._finish()
        if self.transport is not None and not self.transport.is_closing():
            self.transport.abort()

    def _finish(self) -> None:
        self.done = True
        if self.timer is not None:
            self.timer.cancel()
            self.timer = None
        self.router.waiting.discard(self)

    def _send(self, response: bytes) -> None:
        self._finish()
        self.transport.write(response)
        self.transport.close()  # after the buffered answer is written

    def _answer(self, head: bytes) -> None:
        local = self.transport.get_extra_info("sockname")
        local_port = local[1] if isinstance(local, tuple) and len(local) >= 2 else None
        method, location = redirect_location(head, self.router.allowed_names(), local_port)
        with_body = method != b"HEAD"
        if location is None:
            self._send(_response("400 Bad Request", [], b"Bad request.\n", with_body))
            return
        body = f"This server uses HTTPS: {location}\n".encode("ascii")
        self._send(_response("307 Temporary Redirect", [f"Location: {location}"], body, with_body))

    def _hand_to_tls(self, first: bytes) -> None:
        """As loop.start_tls does, with the handshake bytes already read fed in first."""
        self._finish()
        transport = self.transport
        if self.router.closing:
            transport.abort()
            return
        loop = asyncio.get_running_loop()
        app_protocol = self.http_protocol_class(**self.kwargs)
        waiter = loop.create_future()
        handshaking = self.router.handshaking
        handshaking.add(transport)

        def handshake_ended(future):
            # Done (uvicorn now has the connection) or failed (asyncio closed it)
            handshaking.discard(transport)
            _ignore_result(future)

        waiter.add_done_callback(handshake_ended)
        tls = sslproto.SSLProtocol(loop, app_protocol, self.router.ssl_context, waiter, server_side=True)
        transport.set_protocol(tls)
        tls.connection_made(transport)
        _feed(tls, first)
