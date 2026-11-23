"""The desktop app's "Share on my network": turn the network listener on and off, its settings, and the
accounts. No password is asked: the desktop app holds the token, so it is the owner on this machine, and
it can't lock anyone out (it may remove or turn off the last owner account; viewers alone are enough to
share from here).

Only main.app includes this router, and local_owner answers 404 to anything but the desktop app. Every
change is a POST (no PATCH), so the desktop's CORS rules stay as they are."""
import asyncio
import os
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints

import app_state
import paths
import server_config
from account_admin import (
    AddAccountRequest,
    SetPasswordRequest,
    UpdateAccountRequest,
    accounts_view,
    describe_change,
    error,
    new_hash_refusal,
    run_change,
)
from auth_context import local_owner
from network_listener import cert_fingerprint, lan_addresses, listen_urls, self_signed_cert_file

router = APIRouter(dependencies=[Depends(local_owner)])

MAX_ROOTS = 200
_PATH_MAX = 4096
_NETWORK_MAX = 64  # an IPv6 range with its prefix is at most 43 characters


class SharingChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Optional[bool] = None
    port: Optional[StrictInt] = None
    tls_mode: Optional[Literal["off", "files", "self_signed"]] = None
    cert_file: Optional[str] = Field(None, max_length=_PATH_MAX)
    key_file: Optional[str] = Field(None, max_length=_PATH_MAX)
    library_roots: Optional[list[str]] = Field(None, max_length=MAX_ROOTS)
    # Applies to the next request; no restart (the gate reads the settings per request)
    local_networks: Optional[list[Annotated[str, StringConstraints(max_length=_NETWORK_MAX)]]] = Field(
        None, max_length=server_config.MAX_LOCAL_NETWORKS)


def _store():
    return app_state.server_config


def _listener():
    return getattr(app_state, "network_listener", None)


def _web_ui_installed() -> bool:
    return bool(paths.WEB_DIR) and os.path.isfile(os.path.join(str(paths.WEB_DIR), "index.html"))


def _problem_list(pairs) -> list:
    seen, found = set(), []
    for code, message in pairs:
        if code not in seen:
            seen.add(code)
            found.append({"code": code, "message": message})
    return found


def _view(status: dict) -> dict:
    """What the Sharing section shows. Blocking (the file, address lookups): run it in a thread.
    `status`: the listener's status(), taken in the event loop."""
    config = _store().current()
    running = bool(status.get("running"))
    if running:
        urls = list(status.get("urls") or [])
        fingerprint = status.get("fingerprint") or ""
        may_change = False
    else:
        scheme = "https" if config.secure else "http"
        lan = lan_addresses() if config.host in ("0.0.0.0", "::") else []
        urls = listen_urls(scheme, config.host, config.port, config.allowed_hosts, lan=lan)
        cert = ""
        if config.tls_mode == "files":
            cert = config.cert_file
        elif config.tls_mode == "self_signed":
            cert = str(self_signed_cert_file())
        fingerprint = cert_fingerprint(cert) if cert else ""
        # A self-signed certificate is made again when this machine's addresses changed
        may_change = config.tls_mode == "self_signed"
    problems = []
    if not running:
        problems = _problem_list([tuple(p) for p in status.get("problems") or []]
                                 + server_config.start_problems(config, require_owner=False))
    return {
        "enabled": config.enabled,
        "running": running,
        "problems": problems,
        "host": config.host,
        "port": config.port,
        "tls_mode": config.tls_mode,
        "cert_file": config.cert_file,
        "key_file": config.key_file,
        "library_roots": list(config.library_roots),
        "allowed_hosts": list(config.allowed_hosts),
        "public_access": config.public_access,
        "local_networks": list(config.local_networks),
        "from_environment": sorted(config.env_fields),
        "urls": urls,
        "fingerprint": fingerprint,
        "fingerprint_may_change": may_change,
        "web_ui": _web_ui_installed(),
        "accounts": config.account_counts(),
        "config_problems": list(config.problems),
    }


async def _current_view(listener) -> dict:
    status = listener.status() if listener is not None else {"running": False, "problems": []}
    return await asyncio.to_thread(_view, status)


@router.get("/sharing")
async def get_sharing():
    return await _current_view(_listener())


class _FromEnvironment(Exception):
    def __init__(self, fields):
        super().__init__(", ".join(fields))
        self.fields = fields


@router.post("/sharing")
async def change_sharing(req: SharingChange):
    listener = _listener()
    if listener is None:
        return error(503, "start_failed", detail="Sharing isn't available in this backend.")
    store = _store()
    changes = {name: value for name, value in req.model_dump(exclude_unset=True).items() if value is not None}
    for name in ("library_roots", "local_networks"):
        if name in changes:
            changes[name] = tuple(changes[name])

    def prepare():
        # Under the listener's lock: the settings read here are the ones the change is applied to
        previous = store.ensure_secret()
        if previous.load_error:
            raise server_config.ServerConfigError(previous.load_error)
        locked = sorted(set(changes) & previous.env_fields)
        if locked:
            raise _FromEnvironment(locked)
        updated = server_config.validated_changes(store.stored(), **changes)

        def save(include_enabled=True):
            fields = {name: getattr(updated, name) for name in changes if include_enabled or name != "enabled"}
            if fields:
                store.update(**fields)

        return store.with_env(updated), previous, save

    # Turning sharing off always stops it, even when the settings can't be read or written
    stop_first = changes.get("enabled") is False
    try:
        failed, saved = await listener.apply(prepare, stop_first=stop_first)
    except (server_config.ServerConfigError, OSError) as e:
        if stop_first:
            print(f"[Sharing] Stopped, but the setting couldn't be saved: {e}")
            return error(409, "stopped_not_saved", sharing=await _current_view(listener))
        if isinstance(e, OSError):
            return error(409, "config_unreadable", detail=f"Can't write {store.path}.")
        return error(409, "config_unreadable")
    except _FromEnvironment as e:
        return error(409, "from_environment", fields=e.fields)
    except server_config.InvalidSetting as e:
        return error(400, "invalid_setting", detail="; ".join(e.problems), problems=list(e.problems))
    view = await _current_view(listener)
    if failed:
        problems = _problem_list(failed)
        # saved: the other changes in this request were kept (sharing couldn't start, and wasn't running)
        saved = saved and any(name != "enabled" for name in changes)
        return error(409, "start_failed", detail=problems[0]["message"], problems=problems, saved=saved,
                     sharing=view)
    turned = {True: "on", False: "off"}.get(changes.get("enabled"))
    print(f"[Sharing] Changed from the desktop app: {', '.join(sorted(changes)) or 'nothing'}"
          + (f" (sharing {turned})" if turned else ""))
    return view


@router.post("/sharing/sign-out-everywhere")
def sign_out_everywhere():
    _, refusal = run_change(_store().rotate_secret)
    if refusal is not None:
        return refusal
    listener = _listener()
    if listener is not None:
        listener.forget_confirmations()
    print("[Sharing] The desktop app signed out every browser")
    return {"status": "success"}


def _forget(account_id) -> None:
    listener = _listener()
    if listener is not None:
        listener.forget_confirmations(account_id)


@router.get("/sharing/accounts")
def list_accounts():
    return accounts_view(_store().current())


@router.post("/sharing/accounts")
def add_account(req: AddAccountRequest):
    refusal = new_hash_refusal(req.password_hash)
    if refusal is not None:
        return refusal
    result, refusal = run_change(_store().add_account, req.name, req.role, None,
                                 req.permissions.changes() if req.permissions else None,
                                 password_hash=req.password_hash)
    if refusal is not None:
        return refusal
    config, account = result
    print(f"[Sharing] The desktop app added the {account.role} account {account.name}")
    return accounts_view(config)


@router.post("/sharing/accounts/{account_id}")
def update_account(account_id: str, req: UpdateAccountRequest):
    store = _store()
    target = store.current().account_by_id(account_id)
    if target is None:
        return error(404, "no_account")
    config, refusal = run_change(
        store.update_account,
        account_id,
        name=req.name,
        role=req.role,
        permissions=req.permissions.changes() if req.permissions else None,
        disabled=req.disabled,
        keep_owner=False,
    )
    if refusal is not None:
        return refusal
    after = config.account_by_id(account_id)
    if after is not None and (after.role != target.role or after.disabled != target.disabled):
        _forget(account_id)
    print(f"[Sharing] The desktop app changed the account {target.name}: {describe_change(target, after)}")
    return accounts_view(config)


@router.post("/sharing/accounts/{account_id}/password")
def set_account_password(account_id: str, req: SetPasswordRequest):
    refusal = new_hash_refusal(req.password_hash)
    if refusal is not None:
        return refusal
    config, refusal = run_change(_store().set_account_password, account_id, password_hash=req.password_hash)
    if refusal is not None:
        return refusal
    _forget(account_id)
    print(f"[Sharing] The desktop app set the password of {config.account_by_id(account_id).name}")
    return accounts_view(config)


@router.post("/sharing/accounts/{account_id}/sign-out")
def sign_out_account(account_id: str):
    config, refusal = run_change(_store().sign_out_account, account_id)
    if refusal is not None:
        return refusal
    _forget(account_id)
    print(f"[Sharing] The desktop app signed out {config.account_by_id(account_id).name}")
    return accounts_view(config)


@router.post("/sharing/accounts/{account_id}/delete")
def delete_account(account_id: str):
    store = _store()
    target = store.current().account_by_id(account_id)
    if target is None:
        return error(404, "no_account")
    config, refusal = run_change(store.remove_account, account_id, keep_owner=False)
    if refusal is not None:
        return refusal
    _forget(account_id)
    print(f"[Sharing] The desktop app deleted the account {target.name}")
    return accounts_view(config)
