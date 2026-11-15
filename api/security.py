"""Local API hardening: shared-secret token auth, Host/CORS restrictions, upload cap, log redaction.

The Electron app starts the backend with VBLIS_API_TOKEN set and sends it on every request, so
other web pages and local processes can't use the API. See docs/refactor-plan.md (phase B2)."""
import hmac
import logging
import os
import re
import secrets

from starlette.datastructures import Headers, QueryParams
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse

API_TOKEN_ENV = "VBLIS_API_TOKEN"
API_TOKEN_HEADER = "X-VBLIS-Token"
# <img src> can't send headers, so GET /image alone also accepts ?token=
QUERY_TOKEN_PATHS = frozenset({"/image"})
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
# app://vblis is the packaged renderer (app/electron/main.js); any localhost port is the Vite dev
# server. The token is required either way.
CORS_ORIGIN_REGEX = r"^(app://vblis|http://(localhost|127\.0\.0\.1)(:\d+)?)$"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# Multipart framing added on top of the file itself
UPLOAD_OVERHEAD_BYTES = 1024 * 1024
UPLOAD_PATH = "/search/image"

_UNAUTHORIZED = {"detail": "Missing or invalid API token"}
_TOKEN_QUERY_RE = re.compile(r"([?&]token=)[^&\s\"]*")


def resolve_api_token(environ=os.environ) -> str:
    """The token from VBLIS_API_TOKEN, or a random one when it isn't set. There is no open mode."""
    token = (environ.get(API_TOKEN_ENV) or "").strip()
    if token:
        return token
    print(
        f"[Security] {API_TOKEN_ENV} is not set; using a random token, so only a client given "
        f"that token can call the API. Set {API_TOKEN_ENV} to call the API yourself."
    )
    return secrets.token_hex(32)


def is_within(path: str, roots) -> bool:
    """True when path is one of roots or lies below one. Purely lexical (abspath + normcase), so
    '..' is resolved and 'C:\\Photos2' is not inside 'C:\\Photos'. Symlinks/junctions are
    deliberately not resolved: creating one needs local write access, which already implies file access."""
    if not path or "\0" in path:
        return False
    try:
        key = os.path.normcase(os.path.abspath(path))
        for root in roots:
            if not root:
                continue
            root_key = os.path.normcase(os.path.abspath(root))
            if key == root_key or key.startswith(root_key.rstrip(os.sep) + os.sep):
                return True
    except (ValueError, OSError):
        return False
    return False


class TokenAuthMiddleware:
    """Pure ASGI middleware (not BaseHTTPMiddleware) so streamed FileResponses and the many
    thumbnail requests aren't slowed down."""

    def __init__(self, app, token: str):
        self.app = app
        self._token = token.encode("utf-8")

    def _is_valid(self, candidate) -> bool:
        if not candidate:
            return False
        return hmac.compare_digest(candidate.encode("utf-8"), self._token)

    async def __call__(self, scope, receive, send):
        scope_type = scope["type"]
        if scope_type == "lifespan":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        candidate = headers.get(API_TOKEN_HEADER)
        if candidate is None and scope_type == "http" and scope["method"] == "GET" and scope["path"] in QUERY_TOKEN_PATHS:
            candidate = QueryParams(scope["query_string"]).get("token")

        if scope_type == "websocket":
            if not self._is_valid(candidate):
                await send({"type": "websocket.close", "code": 1008})
                return
            await self.app(scope, receive, send)
            return

        if scope_type != "http":
            await self.app(scope, receive, send)
            return

        if not self._is_valid(candidate):
            await JSONResponse(_UNAUTHORIZED, status_code=401)(scope, receive, send)
            return

        if scope["method"] == "POST" and scope["path"] == UPLOAD_PATH:
            length = headers.get("content-length")
            if length is not None and length.isdigit() and int(length) > MAX_UPLOAD_BYTES + UPLOAD_OVERHEAD_BYTES:
                await JSONResponse({"detail": "Upload too large (max 50 MB)"}, status_code=413)(scope, receive, send)
                return

        await self.app(scope, receive, send)


def install(app, token: str) -> None:
    """Order, outermost to innermost: TrustedHost -> CORS -> TokenAuth -> app. add_middleware makes
    the last one added the outermost, so 401s still carry CORS headers the renderer can read."""
    app.add_middleware(TokenAuthMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=CORS_ORIGIN_REGEX,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", API_TOKEN_HEADER],
        allow_credentials=False,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


class RedactTokenFilter(logging.Filter):
    """uvicorn's access log prints the request path with its query string; hide ?token= in it."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _TOKEN_QUERY_RE.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args
            )
        return True


def install_access_log_redaction() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactTokenFilter) for f in access_logger.filters):
        access_logger.addFilter(RedactTokenFilter())
