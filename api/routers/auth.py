"""Signing in and out on the network listener, and changing your own password. Only the network app
includes this router.

No password is ever sent: the browser asks for a challenge and answers it with a proof, and a new
password arrives already hashed (password_proof.py)."""
import math
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import accounts as acct
import password_proof
import path_keys
import replica
import sessions
from account_admin import (  # noqa: F401 - MESSAGES is also imported from here
    MESSAGES,
    NAME_INPUT_MAX,
    Proof,
    account_error,
    error,
    new_hash_refusal,
)
from auth_context import NETWORK, Auth, NetRequest, current_auth, net_request, optional_auth
from server_config import ServerConfigError

router = APIRouter()


class ChallengeRequest(BaseModel):
    name: str = Field(..., max_length=NAME_INPUT_MAX)


class LoginRequest(BaseModel):
    name: str = Field(..., max_length=NAME_INPUT_MAX)
    challenge: str = Field(..., max_length=password_proof.FIELD_MAX)
    proof: str = Field(..., max_length=password_proof.FIELD_MAX)


class OwnPasswordRequest(BaseModel):
    confirm: Optional[Proof] = None
    password_hash: str = Field(..., max_length=password_proof.HASH_FIELD_MAX)


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
        "read_only": replica.is_read_only(),
        "replica": replica.summary() if auth.is_owner else None,
    }


def set_session_cookie(response: Response, net: NetRequest, account) -> None:
    """A cookie for `account`, which must come from the config as it is now (after any change)."""
    token = sessions.issue(net.store.current().session_secret, account, net.scheme)
    response.headers.append("set-cookie", sessions.set_cookie_header(net.cookie_name, token, net.scheme))


def _clear_session_cookie(response: Response, net: NetRequest) -> None:
    response.headers.append("set-cookie", sessions.clear_cookie_header(net.cookie_name, net.scheme))


def _challenges(net: NetRequest):
    if net.challenges is None:
        raise HTTPException(status_code=503, detail="Signing in isn't available here.")
    return net.challenges


def confirm_subject(net: NetRequest, auth: Auth) -> str:
    """What a confirmation challenge belongs to: the account and this sign-in (its cookie's nonce)."""
    nonce = net.session.nonce if net.session is not None else ""
    return f"{auth.account_id}|{nonce}"


class ChallengeExpired(Exception):
    """The challenge a proof answers is unknown, used, too old, or was given to another client or for
    another purpose. It says nothing about the password, so it isn't counted: the browser asks again."""


def check_proof(net: NetRequest, purpose: str, subject: str, proof: Proof, find,
                signed_in_as: Optional[str] = None, refund=True):
    """The account find(config) returns, when `proof` answers a challenge given out for `purpose` and
    `subject` to this client with that account's password; else None. Raises ChallengeExpired.

    The same work for an unknown name (against a random key), so the time taken doesn't tell which
    names exist. Rate-limited per client and per network group. Someone already
    signed in, confirming their own password (`signed_in_as`: their account id), is limited per client
    and per account instead of per group: guessing elsewhere can't block them, and a stolen session
    can't guess that account's password from many addresses. A correct owner password clears the
    client's count; another account's only refunds the attempt, so it can't be used to reset the count
    while guessing an owner's. refund=False keeps even a correct password in the account's count (not
    the client's), for a change of your own password: a signed-in viewer can't repeat it without limit,
    and this browser's sign-ins aren't affected."""
    shared = signed_in_as is None
    wait = net.limiter.begin(net.client, shared=shared, account=signed_in_as, group=net.sign_in_group)
    if wait > 0:
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a moment and try again.",
                            headers={"Retry-After": str(math.ceil(wait))})
    if not _challenges(net).take(proof.challenge, purpose, subject, net.client):
        net.limiter.succeeded(net.client, shared=shared, account=signed_in_as, group=net.sign_in_group)
        raise ChallengeExpired()
    account = find(net.store.current())
    stored = (account.password or None) if account is not None else None
    if not password_proof.proof_matches(stored, purpose, proof.challenge, proof.proof):
        return None
    net.limiter.succeeded(net.client, shared=shared, clear=account.is_owner and account.can_sign_in,
                          account=signed_in_as if refund else None, group=net.sign_in_group)
    return account


def confirm_own_password(net: NetRequest, auth: Auth, proof: Optional[Proof], refund=True) -> Optional[JSONResponse]:
    """None when `proof` proves the signed-in account's own password, else the refusal to answer with.
    The account must still be able to sign in with the role the session was checked for: a change from
    the command line a moment ago (turned off, demoted) counts."""
    if proof is None:
        return error(403, "confirm_password")
    try:
        found = check_proof(net, password_proof.CONFIRM, confirm_subject(net, auth), proof,
                            lambda config: config.account_by_id(auth.account_id),
                            signed_in_as=auth.account_id, refund=refund)
    except ChallengeExpired:
        return error(403, "challenge_expired")
    if found is None:
        return error(403, "wrong_password")
    if not found.can_sign_in or found.role != auth.role:
        return error(403, "account_changed")
    return None


def _sign_in_refusal(net: NetRequest, config) -> Optional[JSONResponse]:
    if config.load_error or (net.require_owner and not config.has_owner):
        return error(503, "no_owner_account")
    if not config.has_sign_in:
        # Shared from the desktop app, which needs no owner account, but nobody can sign in yet
        return error(503, "no_accounts")
    return None


@router.post("/auth/challenge")
def sign_in_challenge(req: ChallengeRequest, net: NetRequest = Depends(net_request)):
    """A one-time challenge for signing in as `name`, with that account's salt and cost values. A name
    without an account gets a made-up salt that stays the same, so the answer doesn't show which
    names exist."""
    config = net.store.ensure_secret()
    refusal = _sign_in_refusal(net, config)
    if refusal is not None:
        return refusal
    subject = acct.name_key(req.name)
    challenge = _challenges(net).issue(password_proof.SIGN_IN, subject, net.client, group=net.sign_in_group)
    account = config.account_by_name(req.name)
    stored = (account.password or None) if account is not None else None
    return password_proof.challenge_answer(challenge, stored,
                                           password_proof.made_up_salt(config.session_secret, subject))


@router.post("/auth/confirm-challenge")
def confirm_challenge(net: NetRequest = Depends(net_request), auth: Auth = Depends(current_auth)):
    """A one-time challenge for confirming a change with your own password, for this sign-in only."""
    config = net.store.current()
    account = config.account_by_id(auth.account_id)
    if account is None or not account.can_sign_in or account.role != auth.role:
        return error(403, "account_changed")
    challenge = _challenges(net).issue(password_proof.CONFIRM, confirm_subject(net, auth), net.client,
                                       group=net.sign_in_group)
    return password_proof.challenge_answer(
        challenge, account.password or None,
        password_proof.made_up_salt(config.session_secret, f"id:{auth.account_id}"))


@router.post("/auth/login")
def login(req: LoginRequest, response: Response, net: NetRequest = Depends(net_request)):
    config = net.store.ensure_secret()
    refusal = _sign_in_refusal(net, config)
    if refusal is not None:
        return refusal
    try:
        account = check_proof(net, password_proof.SIGN_IN, acct.name_key(req.name),
                              Proof(challenge=req.challenge, proof=req.proof),
                              lambda current: current.account_by_name(req.name))
    except ChallengeExpired:
        return error(401, "challenge_expired")
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
    """Any signed-in account changes its own password (sent already hashed). Its other browsers are
    signed out; this one gets a new cookie. Every change counts toward the account's attempt limit, even
    with the right password, so a viewer can't repeat it without limit."""
    refusal = new_hash_refusal(req.password_hash) or confirm_own_password(net, auth, req.confirm, refund=False)
    if refusal is not None:
        return refusal
    try:
        config = net.store.set_account_password(auth.account_id, password_hash=req.password_hash)
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
