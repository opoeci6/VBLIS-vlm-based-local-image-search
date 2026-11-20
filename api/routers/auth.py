"""Signing in and out on the network listener. Only the network app includes this router."""
import math
import os
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

import passwords
import path_keys
import sessions
from auth_context import NetRequest, net_request, optional_auth, Auth, current_auth
from server_config import VIEWER_PERMISSIONS

router = APIRouter()

# scrypt needs 32 MiB and a moment of CPU per attempt; this keeps a burst of attempts from piling up
_hashing = threading.BoundedSemaphore(2)


class LoginRequest(BaseModel):
    password: str = Field(..., max_length=passwords.MAX_LENGTH)


def session_info(auth: Optional[Auth], net: NetRequest) -> dict:
    if auth is None:
        # Before sign-in: only what the sign-in page needs, nothing about the server or its users
        return {"signed_in": False, "role": None, "channel": "network", "secure": net.scheme == "https"}
    config = net.store.current()
    permissions = {name: auth.may(name) for name in VIEWER_PERMISSIONS}
    return {
        "signed_in": auth is not None,
        "role": auth.role if auth else None,
        "permissions": permissions,
        "channel": "network",
        "secure": net.scheme == "https",
        "case_sensitive_paths": not path_keys.FOLD_CASE,
        "path_separator": os.sep,
        "viewer_enabled": bool(config.viewer_password),
    }


def _set_session_cookie(response: Response, net: NetRequest, role: str) -> None:
    config = net.store.current()
    token = sessions.issue(config.session_secret, role, config.password_hashes[role], net.scheme)
    response.headers.append("set-cookie", sessions.set_cookie_header(net.cookie_name, token, net.scheme))


def _clear_session_cookie(response: Response, net: NetRequest) -> None:
    response.headers.append("set-cookie", sessions.clear_cookie_header(net.cookie_name, net.scheme))


def check_password(net: NetRequest, password: str, signed_in_owner: bool = False):
    """The role password belongs to, or None. Rate-limited per client and per network group;
    always hashes twice, so the time taken doesn't tell whether the viewer has a password. An owner
    who is already signed in (changing a password) is limited per client only, so guessing
    elsewhere can't block them."""
    shared = not signed_in_owner
    wait = net.limiter.begin(net.client, shared=shared)
    if wait > 0:
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a moment and try again.",
                            headers={"Retry-After": str(math.ceil(wait))})
    if not _hashing.acquire(timeout=10):
        net.limiter.succeeded(net.client, shared=shared)  # not tried, so not counted
        raise HTTPException(status_code=503, detail="The server is busy. Try again in a moment.",
                            headers={"Retry-After": "5"})
    try:
        config = net.store.current()
        owner_ok = passwords.verify_password(password, config.owner_password or None)
        viewer_ok = passwords.verify_password(password, config.viewer_password or None)
    finally:
        _hashing.release()
    role = "owner" if owner_ok else "viewer" if viewer_ok else None
    if role is not None:
        net.limiter.succeeded(net.client, shared=shared, clear=role == "owner")
    return role


@router.post("/auth/login")
def login(req: LoginRequest, response: Response, net: NetRequest = Depends(net_request)):
    config = net.store.ensure_secret()
    if config.load_error or not config.owner_password:
        raise HTTPException(status_code=503, detail="The server has no owner password yet.")
    role = check_password(net, req.password)
    if role is None:
        print(f"[Network] Failed sign-in from {net.client}")
        raise HTTPException(status_code=401, detail="Wrong password.")
    print(f"[Network] {role} signed in from {net.client}")
    _set_session_cookie(response, net, role)
    grants = config.viewer_grants if role == "viewer" else frozenset()
    return session_info(Auth(role, "network", frozenset(grants), net.client), net)


@router.post("/auth/logout")
def logout(response: Response, net: NetRequest = Depends(net_request)):
    _clear_session_cookie(response, net)
    return {"signed_in": False}


@router.get("/auth/session")
def get_session(net: NetRequest = Depends(net_request), auth: Optional[Auth] = Depends(optional_auth)):
    return session_info(auth, net)


@router.post("/auth/sign-out-everywhere")
def sign_out_everywhere(response: Response, net: NetRequest = Depends(net_request),
                        auth: Auth = Depends(current_auth)):
    net.store.rotate_secret()
    print(f"[Network] The owner signed out every browser (from {net.client})")
    _set_session_cookie(response, net, auth.role)
    return {"status": "success"}
