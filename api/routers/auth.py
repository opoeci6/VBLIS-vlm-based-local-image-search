"""Signing in and out on the network listener, and changing your own password. Only the network app
includes this router."""
import math
import os
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import accounts as acct
import passwords
import path_keys
import sessions
from account_admin import MESSAGES, NAME_INPUT_MAX, account_error, error  # noqa: F401 - also imported from here
from auth_context import NETWORK, Auth, NetRequest, current_auth, net_request, optional_auth
from server_config import ServerConfigError

router = APIRouter()

# scrypt needs 32 MiB and a moment of CPU per attempt; this keeps a burst of attempts from piling up
_hashing = threading.BoundedSemaphore(2)


class LoginRequest(BaseModel):
    name: str = Field(..., max_length=NAME_INPUT_MAX)
    password: str = Field(..., max_length=passwords.MAX_LENGTH)


class OwnPasswordRequest(BaseModel):
    current_password: str = Field(..., max_length=passwords.MAX_LENGTH)
    new_password: str = Field(..., max_length=passwords.MAX_LENGTH)


def auth_for(account, client) -> Auth:
    grants = account.grants if account.role == acct.VIEWER else frozenset()
    return Auth(account.role, NETWORK, frozenset(grants), client, account.id, account.name)


def session_info(auth: Optional[Auth], net: NetRequest) -> dict:
    if auth is None:
        # Before sign-in: only what the sign-in page needs, nothing about the server or its accounts
        return {"signed_in": False, "role": None, "channel": "network", "secure": net.scheme == "https"}
    return {
        "signed_in": True,
        "role": auth.role,
        "account": {"id": auth.account_id, "name": auth.account_name},
        "permissions": {name: auth.may(name) for name in acct.PERMISSIONS},
        "channel": "network",
        "secure": net.scheme == "https",
        "case_sensitive_paths": not path_keys.FOLD_CASE,
        "path_separator": os.sep,
    }


def set_session_cookie(response: Response, net: NetRequest, account) -> None:
    """A cookie for `account`, which must come from the config as it is now (after any change)."""
    token = sessions.issue(net.store.current().session_secret, account, net.scheme)
    response.headers.append("set-cookie", sessions.set_cookie_header(net.cookie_name, token, net.scheme))


def _clear_session_cookie(response: Response, net: NetRequest) -> None:
    response.headers.append("set-cookie", sessions.clear_cookie_header(net.cookie_name, net.scheme))


def check_password(net: NetRequest, password: str, find, signed_in_as: Optional[str] = None, refund=True):
    """The account find(config) returns, when `password` is its password; else None.

    Always exactly one scrypt hash, also for an unknown name (against a dummy hash), so the time taken
    doesn't tell which names exist. Rate-limited per client and per network group. Someone already
    signed in, confirming their own password (`signed_in_as`: their account id), is limited per client
    and per account instead of per group: guessing elsewhere can't block them, and a stolen session
    can't guess that account's password from many addresses. A correct owner password clears the
    client's count; another account's only refunds the attempt, so it can't be used to reset the count
    while guessing an owner's. refund=False keeps even a correct password in the account's count (not
    the client's), for a request that costs more hashing after it (a new password): a signed-in viewer
    can't repeat it without limit, and this browser's sign-ins aren't affected."""
    shared = signed_in_as is None
    wait = net.limiter.begin(net.client, shared=shared, account=signed_in_as)
    if wait > 0:
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a moment and try again.",
                            headers={"Retry-After": str(math.ceil(wait))})
    if not _hashing.acquire(timeout=10):
        net.limiter.succeeded(net.client, shared=shared, account=signed_in_as)  # not tried, so not counted
        raise HTTPException(status_code=503, detail="The server is busy. Try again in a moment.",
                            headers={"Retry-After": "5"})
    try:
        account = find(net.store.current())
        correct = passwords.verify_password(password, (account.password or None) if account is not None else None)
    finally:
        _hashing.release()
    if not correct:
        return None
    net.limiter.succeeded(net.client, shared=shared, clear=account.is_owner and account.can_sign_in,
                          account=signed_in_as if refund else None)
    return account


def confirm_own_password(net: NetRequest, auth: Auth, password, refund=True) -> Optional[JSONResponse]:
    """None when `password` is the signed-in account's own password, else the refusal to answer with.
    The account must still be able to sign in with the role the session was checked for: a change from
    the command line a moment ago (turned off, demoted) counts."""
    if not password:
        return error(403, "confirm_password")
    found = check_password(net, password, lambda config: config.account_by_id(auth.account_id),
                           signed_in_as=auth.account_id, refund=refund)
    if found is None:
        return error(403, "wrong_password")
    if not found.can_sign_in or found.role != auth.role:
        return error(403, "account_changed")
    return None


@router.post("/auth/login")
def login(req: LoginRequest, response: Response, net: NetRequest = Depends(net_request)):
    config = net.store.ensure_secret()
    if config.load_error or (net.require_owner and not config.has_owner):
        return error(503, "no_owner_account")
    if not config.has_sign_in:
        # Shared from the desktop app, which needs no owner account, but nobody can sign in yet
        return error(503, "no_accounts")
    account = check_password(net, req.password, lambda current: current.account_by_name(req.name))
    if account is None:
        known = net.store.current().account_by_name(req.name)
        target = f" as {known.name}" if known is not None else ""
        print(f"[Network] Failed sign-in{target} from {net.client}")
        return error(401, "wrong_name_or_password")
    if account.disabled:
        # Said only after the right password, so it tells a guesser nothing
        print(f"[Network] {account.name} tried to sign in from {net.client}, but the account is turned off")
        return error(403, "account_off")
    print(f"[Network] {account.name} ({account.role}) signed in from {net.client}")
    set_session_cookie(response, net, account)
    return session_info(auth_for(account, net.client), net)


@router.post("/auth/logout")
def logout(response: Response, net: NetRequest = Depends(net_request)):
    # The cookie stays valid until it expires (nothing is stored on the server), but a password
    # confirmation remembered for this sign-in must not outlive it
    if net.session is not None and net.confirmations is not None:
        net.confirmations.forget(net.session.account_id, net.session.nonce)
    _clear_session_cookie(response, net)
    return {"signed_in": False}


@router.get("/auth/session")
def get_session(net: NetRequest = Depends(net_request), auth: Optional[Auth] = Depends(optional_auth)):
    return session_info(auth, net)


@router.post("/auth/password")
def change_own_password(req: OwnPasswordRequest, response: Response, net: NetRequest = Depends(net_request),
                        auth: Auth = Depends(current_auth)):
    """Any signed-in account changes its own password. Its other browsers are signed out; this one gets a
    new cookie. Every change counts toward the account's attempt limit, even with the right password:
    each one costs two hashes, and a viewer must not be able to keep the server busy with them."""
    refusal = confirm_own_password(net, auth, req.current_password, refund=False)
    if refusal is not None:
        return refusal
    try:
        config = net.store.set_account_password(auth.account_id, req.new_password)
    except acct.AccountError as e:
        return account_error(e)
    except ServerConfigError:
        return error(409, "config_unreadable")
    print(f"[Network] {auth.account_name} changed their password (from {net.client})")
    if net.confirmations is not None:
        net.confirmations.forget(auth.account_id)
    account = config.account_by_id(auth.account_id)
    if account is not None and account.can_sign_in:
        set_session_cookie(response, net, account)
    return {"status": "success"}


@router.post("/auth/sign-out-everywhere")
def sign_out_everywhere(response: Response, net: NetRequest = Depends(net_request),
                        auth: Auth = Depends(current_auth)):
    config = net.store.rotate_secret()
    if net.confirmations is not None:
        net.confirmations.clear()
    print(f"[Network] {auth.account_name} signed out every browser (from {net.client})")
    account = config.account_by_id(auth.account_id)
    if account is not None and account.can_sign_in:
        set_session_cookie(response, net, account)
    return {"status": "success"}
