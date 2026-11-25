"""The app the network listener serves: the desktop app's routes plus sign-in, the folder picker,
originals and the owner's settings, behind NetworkGate. ROUTE_TABLE says who may call each
route; a route missing from it is refused, and a test fails when that happens."""
import secrets

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import netaddr
import ratelimit
import replica
import security
from network_gate import OWNER_ROUTE, PUBLIC, VIEWER_ROUTE, NetworkGate
from routers import auth, fs, indexing, media, models, original, queue, search, server_settings, settings

SHARED_ROUTERS = (settings, search, indexing, queue, models, media)
NETWORK_ROUTERS = (auth, fs, original, server_settings)

_VIEWER_IMAGE_SEARCH = VIEWER_ROUTE + ":image_search"
_VIEWER_ORIGINALS = VIEWER_ROUTE + ":originals"

ROUTE_TABLE = {
    # Signing in
    ("POST", "/auth/challenge"): PUBLIC,  # the salt and a one-time challenge for signing in
    ("POST", "/auth/login"): PUBLIC,
    ("POST", "/auth/logout"): PUBLIC,
    ("GET", "/auth/session"): PUBLIC,
    ("POST", "/auth/confirm-challenge"): VIEWER_ROUTE,  # a challenge for confirming with your own password
    ("POST", "/auth/password"): VIEWER_ROUTE,  # any signed-in account, its own password
    ("POST", "/auth/sign-out-everywhere"): OWNER_ROUTE,
    # Search and browse
    ("POST", "/search"): VIEWER_ROUTE,
    ("POST", "/search/image"): _VIEWER_IMAGE_SEARCH,
    ("POST", "/search/ref"): VIEWER_ROUTE,
    ("POST", "/search/video"): VIEWER_ROUTE,
    ("POST", "/browse"): VIEWER_ROUTE,
    ("GET", "/search/filter-options"): VIEWER_ROUTE,
    ("GET", "/image"): VIEWER_ROUTE,
    ("POST", "/video/frames/batch-extract"): VIEWER_ROUTE,
    ("GET", "/media/original"): _VIEWER_ORIGINALS,
    ("GET", "/index/folders"): VIEWER_ROUTE,
    ("GET", "/index/folder/contents"): VIEWER_ROUTE,
    ("GET", "/status"): VIEWER_ROUTE,  # trimmed for viewers (routers/indexing.py)
    ("GET", "/models"): VIEWER_ROUTE,
    # The owner: folders and indexing
    ("POST", "/index/clear"): OWNER_ROUTE,
    ("POST", "/index/cancel"): OWNER_ROUTE,
    ("POST", "/index/folder/delete"): OWNER_ROUTE,
    ("POST", "/index/folder/reindex"): OWNER_ROUTE,
    ("POST", "/index/folders/batch-delete"): OWNER_ROUTE,
    ("POST", "/index/folders/batch-reindex"): OWNER_ROUTE,
    ("POST", "/index/media-info/scan"): OWNER_ROUTE,
    ("GET", "/fs/roots"): OWNER_ROUTE,
    ("GET", "/fs/list"): OWNER_ROUTE,
    # The owner: the queue
    ("GET", "/queue"): OWNER_ROUTE,
    ("POST", "/queue/enqueue"): OWNER_ROUTE,
    ("POST", "/queue/control"): OWNER_ROUTE,
    ("POST", "/queue/{task_id}/cancel"): OWNER_ROUTE,
    ("POST", "/queue/{task_id}/pause"): OWNER_ROUTE,
    ("POST", "/queue/{task_id}/resume"): OWNER_ROUTE,
    ("POST", "/queue/{task_id}/move"): OWNER_ROUTE,
    ("POST", "/queue/reorder"): OWNER_ROUTE,
    ("POST", "/queue/{task_id}/retry"): OWNER_ROUTE,
    ("DELETE", "/queue/history"): OWNER_ROUTE,
    # The owner: models, performance and caches
    ("POST", "/models/delete"): OWNER_ROUTE,
    ("POST", "/models/download"): OWNER_ROUTE,
    ("POST", "/models/download/cancel"): OWNER_ROUTE,
    ("POST", "/models/switch"): OWNER_ROUTE,
    ("POST", "/models/unload"): OWNER_ROUTE,
    ("GET", "/settings/gpu"): OWNER_ROUTE,
    ("POST", "/settings/gpu"): OWNER_ROUTE,
    ("GET", "/image/cache/stats"): OWNER_ROUTE,
    ("POST", "/image/cache/clear"): OWNER_ROUTE,
    ("POST", "/video/thumbnails/regenerate"): OWNER_ROUTE,
    # The owner: server settings and accounts
    ("GET", "/server/settings"): OWNER_ROUTE,
    ("GET", "/server/accounts"): OWNER_ROUTE,
    ("POST", "/server/accounts"): OWNER_ROUTE,
    ("PATCH", "/server/accounts/{account_id}"): OWNER_ROUTE,
    ("POST", "/server/accounts/{account_id}/password"): OWNER_ROUTE,
    ("POST", "/server/accounts/{account_id}/sign-out"): OWNER_ROUTE,
    ("POST", "/server/accounts/{account_id}/delete"): OWNER_ROUTE,
}


def build_core_app() -> FastAPI:
    # No trailing-slash redirects: they would point outside /api
    app = FastAPI(title="VBLIS server", docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    for module in SHARED_ROUTERS + NETWORK_ROUTERS:
        app.include_router(module.router)
    replica.install(app)
    security.install_validation_errors(app)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        # Server errors carry exception text with paths and internals; keep that in the log
        if exc.status_code >= 500:
            error_id = secrets.token_hex(4)
            print(f"[Network] {request.method} {request.url.path!r} failed ({error_id}): {exc.detail!r}")
            return JSONResponse(
                {"detail": "Something went wrong on the server.", "error_id": error_id},
                status_code=exc.status_code,
                headers=getattr(exc, "headers", None),
            )
        return await http_exception_handler(request, exc)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):
        error_id = secrets.token_hex(4)
        print(f"[Network] {request.method} {request.url.path!r} failed ({error_id}): {exc!r}")
        return JSONResponse({"detail": "Something went wrong on the server.", "error_id": error_id}, status_code=500)

    return app


def _is_loopback_host(host) -> bool:
    if not isinstance(host, str):
        return False
    return host.strip().lower() == "localhost" or netaddr.is_loopback_client(host)


def build_network_app(store, web_dir=None, port=8080, hostname=None, limiter=None, log=print,
                      require_owner=True, confirmations=None, listen_host=None) -> NetworkGate:
    """require_owner=False when the desktop app shares (see NetworkListener). `confirmations` remembers
    password confirmations in the Accounts window; a new gate starts with an empty one."""
    return NetworkGate(
        build_core_app(),
        ROUTE_TABLE,
        store,
        web_dir=web_dir,
        port=port,
        hostname=hostname,
        limiter=limiter or ratelimit.AttemptLimiter(),
        log=log,
        require_owner=require_owner,
        confirmations=confirmations,
        loopback_only=_is_loopback_host(listen_host),
    )
