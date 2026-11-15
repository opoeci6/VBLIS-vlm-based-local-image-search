"""Who is making a request. The desktop token check (security.TokenAuthMiddleware) and the network
gate put an Auth into the ASGI scope; shared routes read it with Depends(current_auth), which fails
closed when nothing set it."""
from typing import NamedTuple, Optional

from fastapi import HTTPException, Request

SCOPE_KEY = "vblis.auth"
OWNER = "owner"
VIEWER = "viewer"
LOCAL = "local"
NETWORK = "network"


class Auth(NamedTuple):
    role: str
    channel: str
    grants: frozenset = frozenset()
    client: Optional[str] = None
    account_id: Optional[str] = None  # the signed-in network account; None for the desktop app
    account_name: Optional[str] = None

    @property
    def is_network(self) -> bool:
        return self.channel == NETWORK

    @property
    def is_owner(self) -> bool:
        return self.role == OWNER

    def may(self, permission: str) -> bool:
        """The owner may do everything; a viewer only what the owner granted."""
        return self.role == OWNER or permission in self.grants


LOCAL_OWNER = Auth(OWNER, LOCAL)

NET_SCOPE_KEY = "vblis.net"


class NetRequest(NamedTuple):
    """What the network gate learned about a request, for the sign-in routes."""

    client: Optional[str]  # the client's address (from a trusted proxy's header when there is one)
    scheme: str  # "https" when the browser talks HTTPS, directly or to a trusted proxy
    cookie_name: str
    store: object  # server_config.ServerConfigStore
    limiter: object  # ratelimit.AttemptLimiter


def current_auth(request: Request) -> Auth:
    auth = request.scope.get(SCOPE_KEY)
    if not isinstance(auth, Auth):
        raise HTTPException(status_code=401, detail="Not signed in")
    return auth


def optional_auth(request: Request) -> Optional[Auth]:
    auth = request.scope.get(SCOPE_KEY)
    return auth if isinstance(auth, Auth) else None


def net_request(request: Request) -> NetRequest:
    net = request.scope.get(NET_SCOPE_KEY)
    if not isinstance(net, NetRequest):
        raise HTTPException(status_code=404, detail="Not Found")
    return net
