"""What the two ways of managing accounts share: the owner in a browser (routers/server_settings.py, on the
network listener) and the desktop app (routers/sharing.py). The request shapes, the answer with the account
list, the error answers and the log line describing a change."""
from typing import Literal, Optional

from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import accounts as acct
import passwords
from server_config import ServerConfigError

# Longer than any valid name, so a mistyped long name is a wrong name, not a malformed request
NAME_INPUT_MAX = 128

MESSAGES = {
    **acct.MESSAGES,
    "wrong_name_or_password": "Wrong name or password.",
    "account_off": "This account is turned off.",
    "no_owner_account": "The server has no owner account yet.",
    "no_accounts": "No account can sign in yet. Add one in the VBLIS app.",
    "wrong_password": "The current password is wrong.",
    "confirm_password": "Enter your password to confirm this change.",
    "account_changed": "Your account was changed a moment ago. Reload the page and try again.",
    "config_unreadable": "server.json can't be read, so nothing was changed.",
    "from_environment": "This setting is set by an environment variable, so it can't be changed here.",
    "invalid_setting": "That setting isn't valid.",
    "start_failed": "Sharing couldn't start.",
    "stopped_not_saved": "Sharing stopped, but the setting couldn't be saved, so it starts again with the app.",
}
_CONFLICTS = {"name_taken", "too_many", "last_owner", "own_account"}

_PASSWORD_FIELD = Field(..., max_length=passwords.MAX_LENGTH)
# Missing is answered with 403 confirm_password on the network; the desktop app never sends it
_CONFIRM_FIELD = Field(None, max_length=passwords.MAX_LENGTH)


def error(status: int, code: str, headers=None, detail=None, **extra):
    body = {"detail": detail or MESSAGES.get(code, code), "code": code, **extra}
    return JSONResponse(body, status_code=status, headers=headers)


def account_error(exc: acct.AccountError):
    status = 404 if exc.code == "no_account" else 409 if exc.code in _CONFLICTS else 400
    return error(status, exc.code)


def run_change(change, *args, **kwargs):
    """(the store's answer, None), or (None, the error answer) when a rule or the file stops the change."""
    try:
        return change(*args, **kwargs), None
    except acct.AccountError as e:
        return None, account_error(e)
    except ServerConfigError:
        return None, error(409, "config_unreadable")


class Permissions(BaseModel):
    originals: Optional[bool] = None
    image_search: Optional[bool] = None
    places: Optional[bool] = None

    def changes(self) -> dict:
        return self.model_dump(exclude_none=True)


class AddAccountRequest(BaseModel):
    name: str = Field(..., max_length=NAME_INPUT_MAX)
    role: Literal["owner", "viewer"]
    password: str = _PASSWORD_FIELD
    permissions: Optional[Permissions] = None
    current_password: Optional[str] = _CONFIRM_FIELD


class UpdateAccountRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=NAME_INPUT_MAX)
    role: Optional[Literal["owner", "viewer"]] = None
    permissions: Optional[Permissions] = None
    disabled: Optional[bool] = None
    current_password: Optional[str] = _CONFIRM_FIELD


class SetPasswordRequest(BaseModel):
    new_password: str = _PASSWORD_FIELD
    current_password: Optional[str] = _CONFIRM_FIELD


class ConfirmRequest(BaseModel):
    current_password: Optional[str] = _CONFIRM_FIELD


def accounts_view(config, you=None, remembered_s=0, remember_s=0) -> dict:
    """The account list for the Accounts window. `you`: the caller's account id (None for the desktop
    app). `remembered_s`: how long the caller's last password confirmation still counts; `remember_s`:
    how long a confirmation counts (0: every change asks)."""
    return {
        "accounts": [account.public() for account in config.accounts],
        "you": you,
        "confirm_remembered_s": int(remembered_s),
        "limits": {
            "max_accounts": acct.MAX_ACCOUNTS,
            "name_max": acct.NAME_MAX,
            "password_min": passwords.MIN_LENGTH,
            "password_max": passwords.MAX_LENGTH,
            "confirm_remember_s": int(remember_s),
        },
    }


def describe_change(before, after) -> str:
    """What a change did, for the log: "role viewer -> owner, turned on, originals on"."""
    if after is None:
        return "no change"
    parts = []
    if after.name != before.name:
        parts.append(f"renamed to {after.name}")
    if after.role != before.role:
        parts.append(f"role {before.role} -> {after.role}")
    if after.disabled != before.disabled:
        parts.append("turned off" if after.disabled else "turned on")
    for name in acct.PERMISSIONS:
        was, now = name in before.grants, name in after.grants
        if was != now:
            parts.append(f"{name} {'on' if now else 'off'}")
    return ", ".join(parts) or "no change"
