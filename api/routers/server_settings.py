"""The owner's server settings in the browser: what a viewer may do, and the passwords. The
listen address, HTTPS and library folders are changed in server.json, from the command line or
in the desktop app, not from a browser. Only the network app includes this router."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import passwords
from auth_context import NetRequest, net_request
from routers.auth import _set_session_cookie, check_password
from server_config import VIEWER_PERMISSIONS, ServerConfigError

router = APIRouter()

_PASSWORD_MESSAGES = {
    "empty": "The password can't be empty.",
    "too_short": f"The password needs at least {passwords.MIN_LENGTH} characters.",
    "too_long": f"The password can have at most {passwords.MAX_LENGTH} characters.",
    "same_as_other": "The owner and viewer passwords must be different.",
    "wrong_password": "The current owner password is wrong.",
    "config_unreadable": "server.json can't be read, so nothing was changed.",
}


def _error(status: int, code: str):
    return JSONResponse({"detail": _PASSWORD_MESSAGES[code], "code": code}, status_code=status)


def settings_view(net: NetRequest) -> dict:
    config = net.store.current()
    return {
        "viewer_permissions": {name: config.viewer_may(name) for name in VIEWER_PERMISSIONS},
        "viewer_password_set": bool(config.viewer_password),
        "library_roots": list(config.library_roots),
        "port": config.port,
        "tls_mode": config.tls_mode,
        "public_access": config.public_access,
        "from_environment": sorted(config.env_fields),
    }


class PermissionsRequest(BaseModel):
    originals: Optional[bool] = None
    image_search: Optional[bool] = None


class PasswordRequest(BaseModel):
    role: Literal["owner", "viewer"]
    new_password: str = Field(..., max_length=passwords.MAX_LENGTH)
    current_password: str = Field(..., max_length=passwords.MAX_LENGTH)


class ConfirmRequest(BaseModel):
    current_password: str = Field(..., max_length=passwords.MAX_LENGTH)


@router.get("/server/settings")
def get_server_settings(net: NetRequest = Depends(net_request)):
    return settings_view(net)


@router.put("/server/viewer-permissions")
def set_viewer_permissions(req: PermissionsRequest, net: NetRequest = Depends(net_request)):
    try:
        for name, granted in req.model_dump(exclude_none=True).items():
            net.store.set_viewer_permission(name, granted)
    except ServerConfigError:
        return _error(409, "config_unreadable")
    print(f"[Network] The owner changed the viewer permissions (from {net.client})")
    return settings_view(net)


@router.post("/server/password")
def change_password(req: PasswordRequest, response: Response, net: NetRequest = Depends(net_request)):
    # A session alone isn't enough to change a password: a borrowed or stolen one could lock the owner out
    if check_password(net, req.current_password, signed_in_owner=True) != "owner":
        return _error(403, "wrong_password")
    try:
        config, problem = net.store.set_password(req.role, req.new_password)
    except ServerConfigError:
        return _error(409, "config_unreadable")
    if problem:
        return _error(400, problem)
    print(f"[Network] The owner changed the {req.role} password (from {net.client})")
    if req.role == "owner":
        _set_session_cookie(response, net, "owner")  # the old cookie stopped working with the old password
    return settings_view(net)


@router.post("/server/viewer-password/remove")
def remove_viewer_password(req: ConfirmRequest, net: NetRequest = Depends(net_request)):
    if check_password(net, req.current_password, signed_in_owner=True) != "owner":
        return _error(403, "wrong_password")
    try:
        net.store.clear_password("viewer")
    except ServerConfigError:
        return _error(409, "config_unreadable")
    print(f"[Network] The owner removed the viewer password (from {net.client})")
    return settings_view(net)
