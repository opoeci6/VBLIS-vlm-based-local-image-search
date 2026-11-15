"""Accounts of the network listener: who may sign in, with which role and which permissions.

They are stored in server.json (see server_config.ServerConfigStore, which changes them under its lock).
This module holds the record, the name rules and the rules every change must keep, so the command line
and the browser follow the same ones."""
import re
import secrets
import unicodedata
from dataclasses import dataclass, field, replace
from typing import Optional

import passwords

OWNER = "owner"
VIEWER = "viewer"
ROLES = (OWNER, VIEWER)
# What the owner can allow a viewer, with the defaults of a new viewer account. An owner may everything.
PERMISSIONS = {"originals": False, "image_search": True, "places": True}
MAX_ACCOUNTS = 50
NAME_MAX = 32
NAME_PUNCTUATION = "._-"
# Hangul fillers count as letters but show as nothing, so "alice" plus one would look like "alice"
_INVISIBLE_LETTERS = frozenset("ᅟᅠㅤﾠ")
_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_SALT_RE = re.compile(r"^[0-9a-f]{0,64}$")

MESSAGES = {
    "name_invalid": f"A name has 1 to {NAME_MAX} letters or digits, and may use . _ and -; no spaces.",
    "name_taken": "Another account already has this name.",
    "role_invalid": "The role must be owner or viewer.",
    "permission_invalid": "That isn't a permission an owner can set.",
    "too_many": f"There can be at most {MAX_ACCOUNTS} accounts.",
    "no_account": "There is no such account.",
    "last_owner": "At least one owner account has to stay, and be turned on.",
    "own_account": "You can't delete, turn off or demote your own account here.",
    "empty": "The password can't be empty.",
    "too_short": f"The password needs at least {passwords.MIN_LENGTH} characters.",
    "too_long": f"The password can have at most {passwords.MAX_LENGTH} characters.",
}


class AccountError(ValueError):
    """A change that breaks a rule; `code` names the rule (a key of MESSAGES)."""

    def __init__(self, code: str):
        super().__init__(MESSAGES.get(code, code))
        self.code = code


def default_grants() -> frozenset:
    return frozenset(name for name, on in PERMISSIONS.items() if on)


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    role: str
    password: str = ""  # the stored scrypt hash; "" means this account can't sign in
    grants: frozenset = field(default_factory=default_grants)  # a viewer's permissions
    disabled: bool = False
    session_salt: str = ""  # a new one signs the account out everywhere

    @property
    def key(self) -> str:
        return name_key(self.name)

    @property
    def is_owner(self) -> bool:
        return self.role == OWNER

    @property
    def can_sign_in(self) -> bool:
        return bool(self.password) and not self.disabled

    def may(self, permission: str) -> bool:
        return self.role == OWNER or permission in self.grants

    def permissions(self) -> dict:
        return {name: self.may(name) for name in PERMISSIONS}

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "password": self.password or None,
            "permissions": {name: name in self.grants for name in PERMISSIONS},
            "disabled": self.disabled,
            "session_salt": self.session_salt,
        }

    def public(self) -> dict:
        """What the owner's browser sees: never the hash or the salt."""
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "permissions": {name: name in self.grants for name in PERMISSIONS},
            "disabled": self.disabled,
        }


def normalize_name(name) -> Optional[str]:
    """The name as stored, or None when it breaks the name rules. NFKC, so a name typed in full-width
    letters (as a Chinese or Japanese input method may) is the same name as in normal letters, and is
    stored that way."""
    if not isinstance(name, str):
        return None
    name = unicodedata.normalize("NFKC", name.strip())
    if not 1 <= len(name) <= NAME_MAX:
        return None
    if not all((ch.isalnum() and ch not in _INVISIBLE_LETTERS) or ch in NAME_PUNCTUATION for ch in name):
        return None
    return name


def name_key(name: str) -> str:
    """Names are compared without case: "Alice" and "alice" are one account."""
    return unicodedata.normalize("NFKC", name.strip()).casefold()


def new_id() -> str:
    return secrets.token_hex(6)


def new_salt() -> str:
    return secrets.token_hex(16)


def parse_grants(value, problems, label) -> frozenset:
    """A viewer's permissions from the file. A permission the file doesn't mention gets its default (one
    added in a later version); a value that isn't true or false turns that permission off, and a
    `permissions` that isn't an object turns them all off: a mistake in a hand-edited file never gives
    more access."""
    grants = set(default_grants())
    if value is None:
        return frozenset(grants)
    if not isinstance(value, dict):
        problems.append(f"{label}: expected an object; every permission is off")
        return frozenset()
    for name, on in value.items():
        if name not in PERMISSIONS:
            problems.append(f"{label}: unknown permission {name!r}; ignored")
        elif on is True:
            grants.add(name)
        elif on is False:
            grants.discard(name)
        else:
            problems.append(f"{label}.{name}: expected true or false; it is off")
            grants.discard(name)
    return frozenset(grants)


def parse_accounts(value, problems) -> tuple:
    """Accounts from the file's JSON. A broken entry is left out and listed in problems; so is a second
    account with an id or a name already used (the first one wins)."""
    if value is None:
        return ()
    if not isinstance(value, list):
        problems.append("accounts: expected a list")
        return ()
    found, ids, keys = [], set(), set()
    for position, entry in enumerate(value):
        label = f"accounts[{position}]"
        if not isinstance(entry, dict):
            problems.append(f"{label}: expected an object; left out")
            continue
        account_id = entry.get("id")
        name = normalize_name(entry.get("name"))
        role = entry.get("role")
        if not isinstance(account_id, str) or not _ID_RE.match(account_id):
            problems.append(f"{label}: no valid id; left out")
            continue
        if name is None:
            problems.append(f"{label}: the name breaks the name rules; left out")
            continue
        if role not in ROLES:
            problems.append(f"{label} ({name}): unknown role; left out")
            continue
        if account_id in ids or name_key(name) in keys:
            problems.append(f"{label} ({name}): its id or name is already used; left out")
            continue
        password = entry.get("password")
        if password in (None, ""):
            password = ""
        elif not passwords.is_password_hash(password):
            problems.append(f"{label} ({name}): not a stored password; it can't sign in until a password is set")
            password = ""
        salt = entry.get("session_salt")
        if not isinstance(salt, str) or not _SALT_RE.match(salt):
            if salt not in (None, ""):
                problems.append(f"{label} ({name}): bad session_salt; ignored")
            salt = ""
        disabled = entry.get("disabled", False)
        if not isinstance(disabled, bool):
            problems.append(f"{label} ({name}): disabled must be true or false; the account is turned off")
            disabled = True
        found.append(Account(
            id=account_id,
            name=name,
            role=role,
            password=password,
            grants=parse_grants(entry.get("permissions"), problems, f"{label}.permissions"),
            disabled=disabled,
            session_salt=salt,
        ))
        ids.add(account_id)
        keys.add(name_key(name))
    return tuple(found)


def find(accounts, account_id) -> Optional[Account]:
    for account in accounts:
        if account.id == account_id:
            return account
    return None


def find_by_name(accounts, name) -> Optional[Account]:
    if not isinstance(name, str):
        return None
    key = name_key(name)
    for account in accounts:
        if account.key == key:
            return account
    return None


def has_active_owner(accounts) -> bool:
    return any(account.is_owner and account.can_sign_in for account in accounts)


# ---------------------------------------------------------------- changes (pure: they return a new tuple)

def _check_name(accounts, name, except_id=None) -> str:
    normalized = normalize_name(name)
    if normalized is None:
        raise AccountError("name_invalid")
    key = name_key(normalized)
    if any(account.key == key and account.id != except_id for account in accounts):
        raise AccountError("name_taken")
    return normalized


def _check_grants(changes, grants) -> frozenset:
    grants = set(grants)
    for name, on in (changes or {}).items():
        if name not in PERMISSIONS or not isinstance(on, bool):
            raise AccountError("permission_invalid")
        (grants.add if on else grants.discard)(name)
    return frozenset(grants)


def hash_new_password(password) -> str:
    """The stored hash of a new password, after checking the password rules. It takes a moment of CPU,
    so the store calls it before taking its lock (the network listener reads the config under it)."""
    problem = passwords.password_problem(password)
    if problem:
        raise AccountError(problem)
    return passwords.hash_password(password)


def _check_hash(password_hash) -> str:
    if not passwords.is_password_hash(password_hash):
        raise ValueError("not a password hash from hash_new_password")
    return password_hash


def _keeps_an_owner(before, after) -> None:
    """Refuse a change that leaves no owner able to sign in, unless there was none before either."""
    if has_active_owner(before) and not has_active_owner(after):
        raise AccountError("last_owner")


def add(accounts, name, role, password_hash, permissions=None) -> tuple:
    """(accounts with a new one, the new account). `password_hash` comes from hash_new_password."""
    if len(accounts) >= MAX_ACCOUNTS:
        raise AccountError("too_many")
    if role not in ROLES:
        raise AccountError("role_invalid")
    name = _check_name(accounts, name)
    grants = _check_grants(permissions, default_grants())
    password_hash = _check_hash(password_hash)
    existing_ids = {account.id for account in accounts}
    account_id = new_id()
    while account_id in existing_ids:
        account_id = new_id()
    account = Account(account_id, name, role, password_hash, grants, False, new_salt())
    return accounts + (account,), account


def update(accounts, account_id, name=None, role=None, permissions=None, disabled=None, acting_id=None) -> tuple:
    """Rename, change the role, the permissions, or turn the account on or off. `acting_id` is the
    account making the change from a browser: it can't turn itself off or demote itself."""
    target = find(accounts, account_id)
    if target is None:
        raise AccountError("no_account")
    changes = {}
    if name is not None:
        changes["name"] = _check_name(accounts, name, except_id=account_id)
    if role is not None:
        if role not in ROLES:
            raise AccountError("role_invalid")
        changes["role"] = role
    if permissions is not None:
        changes["grants"] = _check_grants(permissions, target.grants)
    if disabled is not None:
        if not isinstance(disabled, bool):
            raise AccountError("permission_invalid")
        changes["disabled"] = disabled
        if disabled and not target.disabled:
            # Turning off ends the account's sessions for good: turning it on again must not bring back
            # a cookie on a lost phone
            changes["session_salt"] = new_salt()
    if acting_id is not None and acting_id == account_id:
        if changes.get("disabled") is True or (target.is_owner and changes.get("role", OWNER) != OWNER):
            raise AccountError("own_account")
    updated = replace(target, **changes)
    after = tuple(updated if account.id == account_id else account for account in accounts)
    _keeps_an_owner(accounts, after)
    return after


def set_password(accounts, account_id, password_hash) -> tuple:
    """A new password (its hash, from hash_new_password); the account's sessions end (they are signed
    with the old hash)."""
    target = find(accounts, account_id)
    if target is None:
        raise AccountError("no_account")
    password_hash = _check_hash(password_hash)
    return tuple(replace(account, password=password_hash) if account.id == account_id else account
                 for account in accounts)


def sign_out(accounts, account_id) -> tuple:
    if find(accounts, account_id) is None:
        raise AccountError("no_account")
    return tuple(replace(account, session_salt=new_salt()) if account.id == account_id else account
                 for account in accounts)


def remove(accounts, account_id, acting_id=None) -> tuple:
    if find(accounts, account_id) is None:
        raise AccountError("no_account")
    if acting_id is not None and acting_id == account_id:
        raise AccountError("own_account")
    after = tuple(account for account in accounts if account.id != account_id)
    _keeps_an_owner(accounts, after)
    return after
