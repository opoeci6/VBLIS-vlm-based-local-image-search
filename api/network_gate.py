"""The network listener's front door: a pure ASGI app in front of the network FastAPI app.

In order, for every request:
1. Proxy headers are only believed from trusted_proxies; from anyone else they are refused.
2. The Host header must name this machine (an address, its host name, or allowed_hosts), which
   stops DNS rebinding.
3. Clients outside the private networks (and the owner's other local networks) are refused unless
   public access is on, and then only over HTTPS.
4. Anything outside /api is a file of the built interface, served from a fixed list.
5. Under /api: changes need an Origin equal to this site and a declared body size; then the
   session cookie gives the role, and the route table decides. A route with no entry is refused.
Security headers are added to every answer. A refusal or an API error is JSON for the interface, and a page
(error_pages) when the browser loaded the address by itself."""
import asyncio
import os
import socket

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.routing import Match

import error_pages
import netaddr
import ratelimit
import sessions
from auth_context import NET_SCOPE_KEY, NETWORK, SCOPE_KEY, VIEWER, Auth, NetRequest
from confirm_memory import RecentConfirmations
from password_proof import ChallengeStore

API_PREFIX = "/api"
MAX_JSON_BODY = 1024 * 1024
MAX_UPLOAD_BODY = 51 * 1024 * 1024
UPLOAD_PATHS = frozenset({"/search/image"})
MAX_PARALLEL_UPLOADS = 2
# Routes run in a thread pool shared with the desktop app (40 threads); network requests beyond
# this many wait here, in the event loop, so they can't take all the threads
MAX_PARALLEL_API = 16
# Media answers may be cached by the browser for a while; everything else under /api is not stored
MEDIA_PATHS = frozenset({"/image", "/media/original"})

PUBLIC = "public"
VIEWER_ROUTE = "viewer"
OWNER_ROUTE = "owner"

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
}

_COMMON_HEADERS = (
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "DENY"),
    ("referrer-policy", "no-referrer"),
    ("cross-origin-resource-policy", "same-origin"),
    ("cross-origin-opener-policy", "same-origin"),
)
PAGE_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)
API_CSP = "sandbox; default-src 'none'; frame-ancestors 'none'"
# A picture or video opened in a tab of its own: the browser wraps it in a page of its own (a <video> or <img>
# pointing at the same URL), which this policy also governs. API_CSP would stop that page loading its own
# video (default-src 'none'), and `sandbox` would give it an opaque origin, so the browser sends no sign-in
# cookie and Cross-Origin-Resource-Policy refuses the answer: videos never played. These answers are always
# an image or video type with nosniff, so a browser never runs them as a page; scripts stay off.
MEDIA_CSP = "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"


def scan_web_dir(web_dir) -> dict:
    """{url path: file} for every file of the built interface. Requests are answered only from
    this list, so no path from a request ever reaches the file system."""
    files = {}
    if not web_dir or not os.path.isdir(web_dir):
        return files
    root = os.path.abspath(web_dir)
    for directory, dir_names, file_names in os.walk(root):
        dir_names[:] = [d for d in dir_names if not d.startswith(".")]
        for name in file_names:
            if name.startswith("."):
                continue
            full = os.path.join(directory, name)
            relative = os.path.relpath(full, root).replace(os.sep, "/")
            files["/" + relative] = full
    if "/index.html" in files:
        files["/"] = files["/index.html"]
    return files


class NetworkGate:
    def __init__(self, app, route_table, store, web_dir=None, port=8080, hostname=None, limiter=None, log=print,
                 require_owner=True, confirmations=None, challenges=None, loopback_only=False):
        self.app = app
        self.route_table = dict(route_table)
        self.store = store
        self.port = port
        self.static = scan_web_dir(web_dir)
        self.limiter = limiter or ratelimit.AttemptLimiter()
        self.log = log
        self.require_owner = require_owner
        self.confirmations = confirmations if confirmations is not None else RecentConfirmations()
        self.challenges = challenges if challenges is not None else ChallengeStore()
        self.loopback_only = bool(loopback_only)
        self._default_names = netaddr.default_host_names(socket.gethostname() if hostname is None else hostname)
        self._parsed_proxies = ((), ())
        self._parsed_local = ((), ())
        self._uploads = 0
        self._api_slots = None  # created in the server's event loop on first use

    # ---------------------------------------------------------------- helpers

    def allowed_host_names(self, config=None) -> frozenset:
        """The names a Host header may use besides an address. tls_redirect uses the same check."""
        config = config or self.store.current()
        return self._default_names | frozenset(config.allowed_hosts)

    def _proxies(self, config):
        entries, networks = self._parsed_proxies
        if entries != config.trusted_proxies:
            networks = netaddr.parse_networks(config.trusted_proxies)
            self._parsed_proxies = (config.trusted_proxies, networks)
        return networks

    def _locality(self, config, client):
        """ratelimit.PRIVATE for a private address, ratelimit.LOCAL_NETWORKS for one in the owner's other
        local networks, None for anything else. It is also the client's sign-in group."""
        if netaddr.is_private_client(client):
            return ratelimit.PRIVATE
        entries, networks = self._parsed_local
        if entries != config.local_networks:
            networks = netaddr.parse_local_networks(config.local_networks)
            self._parsed_local = (config.local_networks, networks)
        return ratelimit.LOCAL_NETWORKS if netaddr.in_networks(client, networks) else None

    def requirement(self, scope):
        """(route path, requirement) of the route that fully matches scope, or (None, None) when
        no route does (the app then answers 404 or 405 without running anything)."""
        for route in self.app.router.routes:
            match, _ = route.matches(scope)
            if match == Match.FULL:
                path = getattr(route, "path", None)
                for method in getattr(route, "methods", None) or ():
                    if method == scope["method"]:
                        return path, self.route_table.get((method, path))
                return path, None
        return None, None

    @staticmethod
    def _secured(send, extra):
        async def wrapped(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for key, value in _COMMON_HEADERS + extra:
                    if key not in headers:
                        headers.append(key, value)
            await send(message)

        return wrapped

    async def _refuse(self, scope, receive, send, status, detail, headers=None, page=None, address=None):
        """JSON with `detail` for the interface; the error page `page` (an error_pages kind) when the browser
        loaded this address by itself."""
        request_headers = Headers(scope=scope)
        if page is not None and error_pages.wants_page(request_headers):
            response = error_pages.page_response(page, status, request_headers.get("accept-language"),
                                                 address=address, headers=headers)
        else:
            response = JSONResponse({"detail": detail}, status_code=status, headers=headers)
        await response(scope, receive, send)

    # ---------------------------------------------------------------- the request

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        config = self.store.current()
        peer = (scope.get("client") or (None,))[0]
        scheme = scope.get("scheme", "http")
        is_api = scope["path"] == API_PREFIX or scope["path"].startswith(API_PREFIX + "/")
        if is_api:
            csp = MEDIA_CSP if scope["path"][len(API_PREFIX):] in MEDIA_PATHS else API_CSP
            send = self._secured(send, (("content-security-policy", csp),))
        else:
            send = self._secured(send, ())

        # 1. Proxies
        has_proxy = any(name in headers for name in netaddr.FORWARDED_HEADERS)
        if has_proxy:
            trusted = self._proxies(config)
            if not netaddr.in_networks(peer, trusted):
                self.log(f"[Network] Refused {peer}: proxy headers from an address not in trusted_proxies")
                await self._refuse(scope, receive, send, 400,
                                   "This request came through a proxy that VBLIS doesn't trust. "
                                   "Add the proxy's address to trusted_proxies in the server settings.",
                                   page="untrusted_proxy")
                return
            # Every header line counts: some proxies add their own line instead of appending to the
            # client's, and the client controls the first one
            client = netaddr.forwarded_client(",".join(headers.getlist("x-forwarded-for")), trusted)
            protos = [p.strip().lower() for p in ",".join(headers.getlist("x-forwarded-proto")).split(",") if p.strip()]
            if protos and protos[-1] in ("http", "https"):
                scheme = protos[-1]
        else:
            client = peer

        # 2. Host
        if not netaddr.host_allowed(headers.get("host"), self.allowed_host_names(config)):
            self.log(f"[Network] Refused {client}: unknown host name {headers.get('host')!r}")
            await self._refuse(scope, receive, send, 400,
                               "Unknown host name. Use the server's address, or add the name to allowed_hosts.",
                               page="unknown_host")
            return

        # 3. Where the client is
        locality = self._locality(config, client)
        if locality is None:
            if not config.public_access:
                # The address is the client's own, in the form to add (an IPv4 client of a server on :: is
                # shown as IPv4): it tells the owner what to add when the network shows a device on it with
                # an address outside the private ranges
                address = netaddr.parse_ip(client)
                address = str(address) if address is not None else None
                seen = address or "an unknown address"
                self.log(f"[Network] Refused {seen}: access from outside the local network is off "
                         "(a device on your network? add its address to local_networks)")
                await self._refuse(scope, receive, send, 403,
                                   "Access from outside the local network is turned off. "
                                   f"This server sees your device as {seen}.",
                                   page="outside_network", address=address)
                return
            if scheme != "https":
                await self._refuse(scope, receive, send, 403, "Access from the internet needs HTTPS.",
                                   page="needs_https")
                return

        if not is_api:
            await self._serve_static(scope, receive, send)
            return
        parsed_host = netaddr.split_host(headers.get("host"))
        host_is_loopback = (
            parsed_host is not None
            and (parsed_host[0] == "localhost" or netaddr.is_loopback_client(parsed_host[0]))
        )
        on_this_computer = (
            self.loopback_only
            and not has_proxy
            and netaddr.is_loopback_client(peer)
            and host_is_loopback
        )
        await self._serve_api(
            scope, receive, send, headers, config, client, scheme, locality or ratelimit.PUBLIC,
            on_this_computer=on_this_computer,
        )

    async def _serve_static(self, scope, receive, send):
        request_headers = Headers(scope=scope)
        language = request_headers.get("accept-language")
        page = error_pages.wants_page(request_headers)
        if scope["method"] not in ("GET", "HEAD"):
            if page:
                response = error_pages.page_response("method", 405, language)
            else:
                response = PlainTextResponse("Method Not Allowed", status_code=405)
            await response(scope, receive, send)
            return
        path = scope["path"]
        target = self.static.get(path)
        if target is None:
            if path == "/" and not self.static:
                response = error_pages.page_response("not_built", 200, language)
            elif page:
                response = error_pages.page_response("not_found", 404, language)
            else:
                response = PlainTextResponse("Not Found", status_code=404)
            await response(scope, receive, send)
            return
        extension = os.path.splitext(target)[1].lower()
        response_headers = {"cache-control": "no-cache"}
        if path.startswith("/assets/"):
            response_headers["cache-control"] = "public, max-age=31536000, immutable"
        if extension == ".html":
            response_headers["content-security-policy"] = PAGE_CSP
        response = FileResponse(target, media_type=_CONTENT_TYPES.get(extension, "application/octet-stream"),
                                headers=response_headers)
        await response(scope, receive, send)

    async def _serve_api(self, scope, receive, send, headers, config, client, scheme, sign_in_group,
                         on_this_computer=False):
        method = scope["method"]
        sub_path = scope["path"][len(API_PREFIX):] or "/"
        child = dict(scope)
        child["path"] = sub_path
        child["raw_path"] = sub_path.encode("utf-8")

        # 4. Changes: same site only, and a declared body size within the limit
        if method not in ("GET", "HEAD"):
            origin = (headers.get("origin") or "").strip().lower()
            expected = f"{scheme}://{(headers.get('host') or '').strip().lower()}"
            if origin != expected:
                # repr: the decoded path and the header can hold a line break, which would forge a log line
                self.log(f"[Network] Refused {client}: {method} {sub_path!r} from origin {origin or 'none'!r}")
                await self._refuse(scope, receive, send, 403, "Request refused: it didn't come from this site.")
                return
            length = headers.get("content-length")
            if length is None and "transfer-encoding" in headers:
                await self._refuse(scope, receive, send, 411, "The request needs a Content-Length.")
                return
            limit = MAX_UPLOAD_BODY if sub_path in UPLOAD_PATHS else MAX_JSON_BODY
            if length is not None and (not length.isascii() or not length.isdigit() or int(length) > limit):
                await self._refuse(scope, receive, send, 413, "The request is too large.")
                return

        # 5. Who is asking
        session = None
        cookie_name = sessions.cookie_name(scheme, self.port)
        for value in sessions.read_cookies(headers.get("cookie"), cookie_name):
            session = sessions.verify(value, config.session_secret, config.account_by_id, scheme)
            if session is not None:
                break
        auth = None
        if session is not None:
            # Read from this request's config: a permission switched a moment ago applies now
            account = config.account_by_id(session.account_id)
            if account is not None:
                grants = account.grants if account.role == VIEWER else frozenset()
                auth = Auth(account.role, NETWORK, frozenset(grants), client, account.id, account.name,
                            on_this_computer=on_this_computer)
        child[NET_SCOPE_KEY] = NetRequest(client, scheme, cookie_name, self.store, self.limiter,
                                          self.require_owner, session if auth is not None else None,
                                          self.confirmations, sign_in_group, self.challenges)
        if auth is not None:
            child[SCOPE_KEY] = auth

        # 6. May they?
        route_path, requirement = self.requirement(child)
        if route_path is not None:
            if requirement is None:
                await self._refuse(scope, receive, send, 403, "This isn't available over the network.",
                                   page="not_on_network")
                return
            if requirement != PUBLIC:
                if auth is None:
                    await self._refuse(scope, receive, send, 401, "Sign in first.", page="sign_in")
                    return
                level, _, permission = requirement.partition(":")
                if level == OWNER_ROUTE and not auth.is_owner:
                    await self._refuse(scope, receive, send, 403, "Only the owner can do this.", page="owner_only")
                    return
                if permission and not auth.may(permission):
                    await self._refuse(scope, receive, send, 403, "The owner hasn't allowed this.",
                                       page="not_permitted")
                    return

        cache = "private, max-age=600" if sub_path in MEDIA_PATHS else "no-store"
        send = self._secured(send, (("cache-control", cache),))
        if error_pages.wants_page(headers):
            # A picture or video opened in a tab of its own, or an address typed by hand: an error shows as a page
            send = error_pages.html_errors(send, headers.get("accept-language"))
        if self._api_slots is None:
            self._api_slots = asyncio.Semaphore(MAX_PARALLEL_API)
        if sub_path in UPLOAD_PATHS and method == "POST":
            if self._uploads >= MAX_PARALLEL_UPLOADS:
                await self._refuse(scope, receive, send, 503, "The server is busy. Try again in a moment.",
                                   headers={"retry-after": "2"})
                return
            self._uploads += 1
            try:
                async with self._api_slots:
                    await self.app(child, receive, send)
            finally:
                self._uploads -= 1
            return
        async with self._api_slots:
            await self.app(child, receive, send)
