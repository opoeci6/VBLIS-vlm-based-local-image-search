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
    # False when the desktop app shares: it is the owner, so viewer accounts alone are enough
    require_owner: bool = True
    session: object = None  # the verified sessions.Session, or None
    confirmations: object = None  # confirm_memory.RecentConfirmations of this listener
    # The client's sign-in group (ratelimit.PRIVATE, LOCAL_NETWORKS or PUBLIC), as the gate placed it; None:
    # from the address alone
    sign_in_group: Optional[str] = None
    challenges: object = None  # password_proof.ChallengeStore of this listener


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


def local_owner(request: Request) -> Auth:
    """The desktop app itself (it holds the token), never a network request: 404 otherwise. For the
    routes that only the desktop app may call, such as turning sharing on."""
    auth = request.scope.get(SCOPE_KEY)
    if (request.scope.get(NET_SCOPE_KEY) is not None or not isinstance(auth, Auth)
            or auth.channel != LOCAL or not auth.is_owner):
        raise HTTPException(status_code=404, detail="Not Found")
    return auth
