"""The owner's server settings in the browser: the accounts (who may sign in, with which role and which
permissions) and a summary of the server's settings. The listen address, HTTPS and library folders are
changed in server.json, from the command line or in the desktop app, not from a browser. Only the network
app includes this router, and every route here is owner-only (network_app.ROUTE_TABLE).

Changes that give access or could lock an owner out need the acting owner's own password (proved without
sending it, password_proof.py) as well as the session: adding, renaming, a role, a password, deleting, turning an owner on or off, turning any account
back on, and switching a viewer's permission on. A stolen session alone then can't create a lasting way
in or widen anyone's access. Switching a permission off, turning a viewer off and signing an account out
only take access away, so the session is enough.

A correct password is remembered for a few minutes for the same sign-in from the same address
(confirm_memory.py), so a run of changes to viewers asks once. Anything that could give someone owner
access or lock you out always asks: adding an owner, making an account an owner, turning an owner account
back on, setting an owner's password, and any change to your own account (renaming it would lock you out
too, since you sign in by name). So a stolen session in those minutes can't create a lasting owner login."""
from typing import Optional

from fastapi import APIRouter, Depends, Response

from account_admin import (
    AddAccountRequest,
    ConfirmRequest,
    Proof,
    SetPasswordRequest,
    UpdateAccountRequest,
    accounts_view as _accounts_view,
    describe_change,
    error,
    new_hash_refusal,
    run_change,
)
from auth_context import Auth, NetRequest, current_auth, net_request
from routers.auth import confirm_own_password, set_session_cookie

router = APIRouter()


def settings_view(net: NetRequest) -> dict:
    config = net.store.current()
    return {
        "accounts": config.account_counts(),
        "library_roots": list(config.library_roots),
        "port": config.port,
        "tls_mode": config.tls_mode,
        "public_access": config.public_access,
        "from_environment": sorted(config.env_fields),
    }


def _remembered(net: NetRequest, auth: Auth, config) -> float:
    if net.confirmations is None or net.session is None:
        return 0.0
    return net.confirmations.remaining(config.account_by_id(auth.account_id), net.session.nonce, net.client)


def accounts_view(net: NetRequest, auth: Auth, config=None) -> dict:
    config = config or net.store.current()
    remember_s = net.confirmations.seconds if net.confirmations is not None else 0
    return _accounts_view(config, you=auth.account_id, remembered_s=_remembered(net, auth, config),
                          remember_s=remember_s)


def confirm_for_accounts(net: NetRequest, auth: Auth, proof: Optional[Proof], remembered_ok=True) -> Optional[Response]:
    """None when the change may go ahead: `proof` proves the caller's own password, or (remembered_ok) a
    correct one was given a moment ago in this sign-in from this address. Else the refusal to answer with.
    A wrong password also forgets the remembered one."""
    memory, session = net.confirmations, net.session
    if proof is not None:
        refusal = confirm_own_password(net, auth, proof)
        if memory is not None and session is not None:
            if refusal is None:
                memory.remember(net.store.current().account_by_id(auth.account_id), session.nonce, net.client)
            elif _is_wrong_password(refusal):
                memory.forget(auth.account_id, session.nonce)
        return refusal
    if remembered_ok and _remembered(net, auth, net.store.current()) > 0:
        return None
    return error(403, "confirm_password")


def _is_wrong_password(refusal) -> bool:
    # An expired challenge says nothing about the password: keep what was remembered
    return getattr(refusal, "code", None) != "challenge_expired"


def _gives_owner_access(target, req: UpdateAccountRequest) -> bool:
    """Whether the change lets someone sign in as an owner who couldn't before: making an account an owner,
    or turning a turned-off owner account back on."""
    becomes_owner = (req.role or target.role) == "owner"
    return becomes_owner and (not target.is_owner or (target.disabled and req.disabled is False))


def _forget(net: NetRequest, account_id) -> None:
    """A change to an account (its password, sign-out, role, on or off, deleted) ends what it confirmed."""
    if net.confirmations is not None:
        net.confirmations.forget(account_id)


def _gives_access(target, req: UpdateAccountRequest) -> bool:
    """Whether the change needs the acting owner's password (see the module docstring)."""
    if req.name is not None or req.role is not None:
        return True
    if req.disabled is not None and (target.is_owner or (req.disabled is False and target.disabled)):
        return True
    changes = req.permissions.changes() if req.permissions else {}
    # The stored grants, also for an owner: they apply if that owner is ever made a viewer
    return any(on is True and name not in target.grants for name, on in changes.items())


def _keep_signed_in(response: Response, net: NetRequest, auth: Auth, config) -> None:
    """After a change to the caller's own account (a new password or salt), a new cookie for this browser."""
    account = config.account_by_id(auth.account_id)
    if account is not None and account.can_sign_in:
        set_session_cookie(response, net, account)


@router.get("/server/settings")
def get_server_settings(net: NetRequest = Depends(net_request)):
    return settings_view(net)


@router.get("/server/accounts")
def list_accounts(net: NetRequest = Depends(net_request), auth: Auth = Depends(current_auth)):
    return accounts_view(net, auth)


@router.post("/server/accounts")
def add_account(req: AddAccountRequest, net: NetRequest = Depends(net_request), auth: Auth = Depends(current_auth)):
    refusal = new_hash_refusal(req.password_hash) or confirm_for_accounts(
        net, auth, req.confirm, remembered_ok=req.role != "owner")
    if refusal is not None:
        return refusal
    result, refusal = run_change(net.store.add_account, req.name, req.role, None,
                                 req.permissions.changes() if req.permissions else None,
                                 password_hash=req.password_hash)
    if refusal is not None:
        return refusal
    config, account = result
    print(f"[Network] {auth.account_name} added the {account.role} account {account.name} (from {net.client})")
    return accounts_view(net, auth, config)


@router.patch("/server/accounts/{account_id}")
def update_account(account_id: str, req: UpdateAccountRequest, net: NetRequest = Depends(net_request),
                   auth: Auth = Depends(current_auth)):
    # No new cookie needed: a rename keeps the id, and the store refuses turning off or demoting yourself
    target = net.store.current().account_by_id(account_id)
    if target is None:
        return error(404, "no_account")
    if _gives_access(target, req):
        remembered_ok = account_id != auth.account_id and not _gives_owner_access(target, req)
        refusal = confirm_for_accounts(net, auth, req.confirm, remembered_ok=remembered_ok)
        if refusal is not None:
            return refusal
    config, refusal = run_change(
        net.store.update_account,
        account_id,
        name=req.name,
        role=req.role,
        permissions=req.permissions.changes() if req.permissions else None,
        disabled=req.disabled,
        acting_id=auth.account_id,
    )
    if refusal is not None:
        return refusal
    after = config.account_by_id(account_id)
    if after is not None and (after.role != target.role or after.disabled != target.disabled):
        _forget(net, account_id)
    print(f"[Network] {auth.account_name} changed the account {target.name}: "
          f"{describe_change(target, after)} (from {net.client})")
    return accounts_view(net, auth, config)


@router.post("/server/accounts/{account_id}/password")
def set_account_password(account_id: str, req: SetPasswordRequest, response: Response,
                         net: NetRequest = Depends(net_request), auth: Auth = Depends(current_auth)):
    refusal = new_hash_refusal(req.password_hash)
    if refusal is not None:
        return refusal
    if account_id == auth.account_id:
        # Your own password always asks: otherwise a stolen session could lock the owner out
        if req.confirm is None:
            return error(403, "confirm_password")
        refusal = confirm_own_password(net, auth, req.confirm)
        if refusal is not None and net.session is not None and _is_wrong_password(refusal):
            _forget(net, auth.account_id)
    else:
        # A new password for an owner account is a lasting owner login: always asks
        target = net.store.current().account_by_id(account_id)
        remembered_ok = target is not None and not target.is_owner
        refusal = confirm_for_accounts(net, auth, req.confirm, remembered_ok=remembered_ok)
    if refusal is not None:
        return refusal
    config, refusal = run_change(net.store.set_account_password, account_id, password_hash=req.password_hash)
    if refusal is not None:
        return refusal
    _forget(net, account_id)
    name = config.account_by_id(account_id).name
    print(f"[Network] {auth.account_name} set the password of {name} (from {net.client})")
    if account_id == auth.account_id:
        _keep_signed_in(response, net, auth, config)
    return accounts_view(net, auth, config)


@router.post("/server/accounts/{account_id}/sign-out")
def sign_out_account(account_id: str, response: Response, net: NetRequest = Depends(net_request),
                     auth: Auth = Depends(current_auth)):
    config, refusal = run_change(net.store.sign_out_account, account_id)
    if refusal is not None:
        return refusal
    _forget(net, account_id)
    print(f"[Network] {auth.account_name} signed out {config.account_by_id(account_id).name} (from {net.client})")
    if account_id == auth.account_id:
        _keep_signed_in(response, net, auth, config)
    return accounts_view(net, auth, config)


@router.post("/server/accounts/{account_id}/delete")
def delete_account(account_id: str, req: ConfirmRequest, net: NetRequest = Depends(net_request),
                   auth: Auth = Depends(current_auth)):
    target = net.store.current().account_by_id(account_id)
    if target is None:
        return error(404, "no_account")
    refusal = confirm_for_accounts(net, auth, req.confirm)
    if refusal is not None:
        return refusal
    config, refusal = run_change(net.store.remove_account, account_id, acting_id=auth.account_id)
    if refusal is not None:
        return refusal
    _forget(net, account_id)
    print(f"[Network] {auth.account_name} deleted the account {target.name} (from {net.client})")
    return accounts_view(net, auth, config)
