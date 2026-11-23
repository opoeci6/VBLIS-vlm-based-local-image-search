"""The backend's command line.

    main.py                              the desktop backend (what the Windows app starts)
    main.py serve                        the network server alone (Linux, Docker, a headless PC)
    main.py add-account NAME --role ...  and the other commands below: change server.json
    main.py export-index FILE            write the index into one file another machine can import
    main.py import-index FILE --map ...  make this data folder a read-only copy of an exported index
    main.py detach-replica               make such a copy an ordinary index again

Every command takes --data-dir. The settings commands run before the backend is imported, so they
work while a server runs (it reads server.json again within a second) and never open the index. The
index commands open the index, so they need the data folder to themselves: they refuse to run while the
desktop app or a server uses it."""
import argparse
import asyncio
import getpass
import os
import secrets
import signal
import sys

import accounts as acct

SETTABLE = {
    "enabled": "enabled",
    "host": "host",
    "port": "port",
    "tls": "tls_mode",
    "cert-file": "cert_file",
    "key-file": "key_file",
    "public-access": "public_access",
    "allowed-hosts": "allowed_hosts",
    "trusted-proxies": "trusted_proxies",
    "local-networks": "local_networks",
}
_ACCOUNT_COMMANDS = {
    "remove-account", "set-password", "rename-account", "set-role", "allow", "disable-account",
    "enable-account", "sign-out",
}
_LIGHT_COMMANDS = _ACCOUNT_COMMANDS | {
    "add-account", "list-accounts", "add-library-folder", "remove-library-folder", "set",
    "sign-out-everywhere", "show-config",
}
# Commands that read or change the index; they run before the backend is imported, holding the data folder
INDEX_COMMANDS = {"export-index", "import-index", "detach-replica"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vblis",
        description="VBLIS backend. Without a command it runs for the desktop app.",
    )
    parser.add_argument("--data-dir", help="the data folder (models, index, settings); default: VBLIS_DATA_DIR")
    commands = parser.add_subparsers(dest="command", metavar="command")
    commands.add_parser("serve", help="run the network server alone")
    p = commands.add_parser("add-account", help="add an account that can sign in")
    p.add_argument("name")
    p.add_argument("--role", required=True, choices=list(acct.ROLES))
    p.add_argument("--stdin", action="store_true", help="read the password from standard input")
    p = commands.add_parser("remove-account", help="delete an account")
    p.add_argument("name")
    p = commands.add_parser("set-password", help="set an account's password")
    p.add_argument("name")
    p.add_argument("--stdin", action="store_true", help="read the password from standard input")
    p = commands.add_parser("rename-account", help="give an account another name")
    p.add_argument("name")
    p.add_argument("new_name")
    p = commands.add_parser("set-role", help="make an account an owner or a viewer")
    p.add_argument("name")
    p.add_argument("role", choices=list(acct.ROLES))
    p = commands.add_parser("allow", help="what a viewer account may do")
    p.add_argument("name")
    p.add_argument("permission", choices=list(acct.PERMISSIONS))
    p.add_argument("value", choices=["on", "off"])
    p = commands.add_parser("disable-account", help="turn an account off without deleting it")
    p.add_argument("name")
    p = commands.add_parser("enable-account", help="turn an account on again")
    p.add_argument("name")
    p = commands.add_parser("sign-out", help="sign one account out of every browser")
    p.add_argument("name")
    commands.add_parser("list-accounts", help="print the accounts")
    p = commands.add_parser("add-library-folder", help="allow browsers to index folders inside this one")
    p.add_argument("path")
    p = commands.add_parser("remove-library-folder", help="stop allowing a library folder")
    p.add_argument("path")
    p = commands.add_parser("set", help="change a server setting")
    p.add_argument("name", choices=sorted(SETTABLE))
    p.add_argument("value", help="lists are comma-separated; true/false for switches")
    commands.add_parser("sign-out-everywhere", help="sign every browser out")
    commands.add_parser("show-config", help="print the server settings")
    p = commands.add_parser("export-index", help="write the index into one file another machine can import")
    p.add_argument("out", metavar="OUT", help="the file to write (.vblis-export is added when missing)")
    p.add_argument("--model", help="the model whose index to export; default: the active model")
    p.add_argument("--no-thumbnails", dest="thumbnails", action="store_false",
                   help="leave the thumbnails out (a smaller file; the other machine makes them itself)")
    p = commands.add_parser("import-index", help="make this data folder a read-only copy of an exported index")
    p.add_argument("file", metavar="FILE", help="the .vblis-export file")
    p.add_argument("--map", action="append", required=True, metavar="FROM=TO",
                   help="a folder of the exporting machine and where its files are here, for example "
                        "'D:\\Photos=/mnt/photos'; repeat for each folder")
    p.add_argument("--force", action="store_true",
                   help="replace an index that was made in this data folder (it is lost)")
    commands.add_parser("detach-replica", help="allow indexing in a data folder that holds an imported copy")
    return parser


def parse(argv):
    """The parsed command line. Sets VBLIS_DATA_DIR first, because importing paths reads it."""
    args = build_parser().parse_args(argv)
    if args.data_dir:
        os.environ["VBLIS_DATA_DIR"] = os.path.abspath(args.data_dir)
    if (args.command == "serve" or args.command in INDEX_COMMANDS) and not (os.environ.get("VBLIS_API_TOKEN") or "").strip():
        # The headless server has no desktop listener, so the desktop token is never used; a random one
        # keeps bootstrap from printing a note about setting it
        os.environ["VBLIS_API_TOKEN"] = secrets.token_hex(32)
    args.light = args.command in _LIGHT_COMMANDS
    args.index = args.command in INDEX_COMMANDS
    return args


# ---------------------------------------------------------------- settings commands

def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("New password: ")
    if getpass.getpass("Repeat it: ") != first:
        raise SystemExit("The two passwords differ; nothing was changed.")
    return first


def _set_field(store, name, value):
    import server_config

    field = SETTABLE[name]
    data = store.stored().to_json()
    if field in ("allowed_hosts", "trusted_proxies", "local_networks"):
        data[field] = [part.strip() for part in value.split(",") if part.strip()]
    elif field in ("tls_mode", "cert_file", "key_file"):
        data["tls"][{"tls_mode": "mode"}.get(field, field)] = value
    else:
        data[field] = value
    parsed = server_config.config_from_json(data)
    if parsed.problems:
        raise SystemExit("Not changed: " + "; ".join(parsed.problems))
    return store.update(**{field: getattr(parsed, field)})


def account_lines(config) -> list:
    """One line per account: name, role, on or off, and a viewer's permissions. Never a hash or a salt."""
    lines = []
    for account in sorted(config.accounts, key=lambda a: a.key):
        line = f"{account.name}  {account.role}  {'off' if account.disabled else 'on'}"
        if not account.is_owner:
            line += "  " + " ".join(f"{name}={'yes' if account.may(name) else 'no'}" for name in acct.PERMISSIONS)
        if not account.password:
            line += "  (no password)"
        lines.append(line)
    return lines


def show_config(store) -> None:
    import server_config

    config = store.current()
    print(f"Settings file: {store.path}")
    if config.load_error:
        print(f"  It can't be read: {config.load_error}")
        return
    print(f"  Shared from the desktop app: {'yes' if config.enabled else 'no'}")
    print(f"  Listens on: {config.host}:{config.port}")
    print(f"  HTTPS: {config.tls_mode}" + (f" ({config.cert_file}, {config.key_file})" if config.tls_mode == "files" else ""))
    print("  Library folders: " + (", ".join(config.library_roots) or "none (browsers can't add folders)"))
    print(f"  Access from the internet: {'on (HTTPS only)' if config.public_access else 'off'}")
    print("  Extra host names: " + (", ".join(config.allowed_hosts) or "none"))
    print("  Trusted proxies: " + (", ".join(config.trusted_proxies) or "none"))
    print("  Other local networks: " + (", ".join(config.local_networks) or "none"))
    counts = config.account_counts()
    print(f"  Accounts: {counts['owners']} owner, {counts['viewers']} viewer"
          + ("" if config.has_owner else " (NO owner account can sign in)"))
    for line in account_lines(config):
        print(f"    {line}")
    if config.env_fields:
        print("  From the environment (VBLIS_SERVER_*): " + ", ".join(sorted(config.env_fields)))
    for problem in config.problems:
        print(f"  Note: {problem}")
    for _code, message in server_config.start_problems(config):
        print(f"  Can't start yet: {message}")


def run_light(args) -> int:
    import server_config

    # An account name the console's code page can't show (a Chinese name on an English Windows, with the
    # output redirected) must not crash a command whose change is already written
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    store = server_config.ServerConfigStore()
    try:
        if args.command != "show-config":
            invalid = store.stored().problems
            if invalid:
                print("Note: these settings in server.json aren't valid and are written back as their defaults:")
                for problem in invalid:
                    print(f"  {problem}")
        if args.command == "add-account":
            _, account = store.add_account(args.name, args.role, _read_password(args.stdin))
            print(f"Account {account.name} added ({account.role}).")
        elif args.command in _ACCOUNT_COMMANDS:
            return _run_account_command(store, args)
        elif args.command == "list-accounts":
            lines = account_lines(store.stored())
            print("\n".join(lines) if lines else "There are no accounts. Add one with: add-account NAME --role owner")
        elif args.command == "add-library-folder":
            root = server_config.normalize_root(args.path)
            if root is None:
                print("Give the full path of a folder (its name must be valid UTF-8).", file=sys.stderr)
                return 1
            if not os.path.isdir(root):
                print(f"Note: {root} doesn't exist right now.")
            roots = tuple(store.stored().library_roots)
            if root not in roots:
                store.update(library_roots=roots + (root,))
            print(f"Library folder added: {root}")
        elif args.command == "remove-library-folder":
            root = server_config.normalize_root(args.path)
            roots = tuple(r for r in store.stored().library_roots if r != root)
            store.update(library_roots=roots)
            print(f"Library folder removed: {root}")
        elif args.command == "set":
            _set_field(store, args.name, args.value)
            print(f"{args.name} = {args.value}")
            if args.name == "tls" and args.value.strip().lower() == "off":
                print("Warning: without HTTPS, anyone on the same network can see the pictures that are "
                      "opened and take over a signed-in session. Use it only on a network you trust.")
        elif args.command == "sign-out-everywhere":
            store.rotate_secret()
            print("Every browser has to sign in again.")
        elif args.command == "show-config":
            show_config(store)
    except (server_config.ServerConfigError, acct.AccountError) as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


def _run_account_command(store, args) -> int:
    """The commands that change one existing account, found by name (without regard to case)."""
    account = store.stored().account_by_name(args.name)
    if account is None:
        print(f"No account named {args.name}.", file=sys.stderr)
        return 1
    command = args.command
    if command == "remove-account":
        store.remove_account(account.id)
        print(f"Account {account.name} removed.")
    elif command == "set-password":
        store.set_account_password(account.id, _read_password(args.stdin))
        print(f"The password of {account.name} is set. {account.name} has to sign in again in every browser.")
    elif command == "rename-account":
        config = store.update_account(account.id, name=args.new_name)
        print(f"Account {account.name} is now called {config.account_by_id(account.id).name}.")
    elif command == "set-role":
        store.update_account(account.id, role=args.role)
        print(f"Account {account.name} is now {args.role}.")
    elif command == "allow":
        on = args.value == "on"
        store.update_account(account.id, permissions={args.permission: on})
        print(f"{account.name} {'may' if on else 'may not'} use {args.permission}.")
        if account.is_owner:
            print(f"Note: {account.name} is an owner and owners may do everything; this is kept for when it is a viewer.")
    elif command == "disable-account":
        store.update_account(account.id, disabled=True)
        print(f"Account {account.name} is turned off.")
    elif command == "enable-account":
        store.update_account(account.id, disabled=False)
        print(f"Account {account.name} is turned on.")
    elif command == "sign-out":
        store.sign_out_account(account.id)
        print(f"{account.name} has to sign in again in every browser.")
    return 0


# ---------------------------------------------------------------- index commands

def run_index_command(args) -> int:
    """Runs one of INDEX_COMMANDS. Importing bootstrap loads .env and takes the data folder's lock, so this
    exits with a message while the desktop app or a server uses the folder."""
    import bootstrap  # noqa: F401

    if args.command == "import-index":
        return _run_import(args)
    if args.command == "detach-replica":
        return _run_detach()
    import chromadb

    import index_export
    import paths
    from folder_registry import FolderRegistry
    from media_registry import MediaRegistry
    from model_list import AVAILABLE_MODELS

    if args.command != "export-index":
        raise SystemExit(f"Unknown command: {args.command}")
    try:
        out_path = index_export.resolve_output_path(os.path.abspath(args.out))
        model_id = args.model or (os.environ.get("ACTIVE_MODEL") or "").strip() or index_export.DEFAULT_MODEL
        if model_id not in AVAILABLE_MODELS:
            raise index_export.ExportError(
                f"Unknown model {model_id}. The models are: {', '.join(AVAILABLE_MODELS)}.", "unknown_model")
        if not (paths.CHROMA_DIR / "chroma.sqlite3").is_file():
            # Opening the client would create an empty index here
            raise index_export.ExportError(f"There is no index in {paths.DATA_ROOT} yet.", "no_index")
        client = chromadb.PersistentClient(path=str(paths.CHROMA_DIR))
        registry = MediaRegistry(paths.DATA_DIR / "media_registry.sqlite3")
        try:
            result = index_export.export_index(
                client, index_export.collection_name_for(model_id), model_id, registry,
                FolderRegistry(paths.DATA_DIR, paths.CACHE_DIR), paths.IMAGE_CACHE_DIR, paths.VIDEO_CACHE_DIR,
                out_path, thumbnails=args.thumbnails, rotation_for=index_export.registry_rotation_for(registry),
                progress=lambda done, total, label: print(f"{label}: {done:,} / {total:,}", flush=True),
            )
        finally:
            registry.close()
    except index_export.ExportError as e:
        print(str(e), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelled; nothing was written.", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"Could not write the export: {e}", file=sys.stderr)
        return 1
    print(f"{index_export.summary(result)} in {result.seconds:g} s.")
    print(f"  {result.images:,} images, {result.video_frames:,} video frames, {result.registry_rows:,} media "
          f"details, {result.image_thumbnails:,} image and {result.video_thumbnails:,} video thumbnails.")
    return 0


def _items(count, noun="item"):
    return f"{count:,} {noun}" + ("" if count == 1 else "s")


def _run_import(args) -> int:
    import index_import
    import paths

    try:
        result = index_import.import_index(
            os.path.abspath(args.file), args.map, chroma_dir=paths.CHROMA_DIR, data_dir=paths.DATA_DIR,
            cache_dir=paths.CACHE_DIR, models_dir=paths.MODELS_DIR, env_file=paths.ENV_FILE,
            force=args.force, progress=lambda line: print(line, flush=True))
    except index_import.ImportProblem as e:
        print(str(e), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        # A stop after the new index is in place comes back as ImportProblem("incomplete") above
        print("Stopped before the new index was put in place; the previous index is unchanged.", file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001  (a damaged file or a full disk, before the new index is in place)
        print(f"Could not import: {e}. The previous index is unchanged.", file=sys.stderr)
        return 1
    print(f"Imported {result.records:,} items ({result.images:,} images, {result.video_frames:,} video frames) "
          f"in {result.seconds:g} s. This data folder is now a read-only copy.")
    if result.dropped:
        print(f"  {_items(result.dropped)} left out: no --map covers their folder.")
    if result.unmapped_roots:
        print("  Folders without a --map: " + ", ".join(result.unmapped_roots))
    if result.duplicates:
        print(f"  {_items(result.duplicates)} left out: they landed on a file already imported.")
    if result.missing:
        print(f"  {_items(result.missing, 'file')} not on this machine (yet), for example:")
        for example in result.missing_examples:
            print(f"    {example}")
    print(f"  Media details: {result.registry_rows:,} files. Thumbnails: {result.image_thumbnails:,} "
          f"pictures, {result.video_thumbnails:,} video frames.")
    if not result.model_present:
        print(f"  The model {result.model_id} isn't downloaded here yet: start the server, sign in as an owner "
              "and download it in Settings.")
    return 0


def _run_detach() -> int:
    import index_import
    import paths

    if index_import.detach_replica(paths.DATA_DIR):
        print("This data folder holds an ordinary index again: indexing is allowed. Importing a new export "
              "later replaces it.")
    else:
        print("This data folder isn't a copy of another index; nothing changed.")
    return 0


# ---------------------------------------------------------------- running the backend

def run_desktop(app) -> int:
    import uvicorn

    import parent_watch

    parent_watch.start()
    uvicorn.run(app, host="127.0.0.1", port=8000, proxy_headers=False)
    return 0


async def serve_headless(app, listener) -> int:
    import app_state

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop(*_):
        loop.call_soon_threadsafe(stop.set)

    for name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, request_stop)
            except (ValueError, OSError):
                pass

    async with app_state.lifespan(app):
        problems = await listener.start()
        if problems:
            for _code, message in problems:
                print(f"[Network] Not started: {message}", file=sys.stderr)
            print("Run 'show-config' to see the settings, 'add-account NAME --role owner' to add an owner.", file=sys.stderr)
            return 1
        stopping = asyncio.ensure_future(stop.wait())
        running = asyncio.ensure_future(listener.wait())
        await asyncio.wait({stopping, running}, return_when=asyncio.FIRST_COMPLETED)
        print("[Network] Stopping...")
        await listener.stop()
        for task in (stopping, running):
            task.cancel()
    return 0


def run_backend(args, app) -> int:
    if args.command == "serve":
        import app_state
        import paths
        from network_listener import NetworkListener

        listener = NetworkListener(app_state.server_config, web_dir=paths.WEB_DIR, embedded=False)
        return asyncio.run(serve_headless(app, listener))
    return run_desktop(app)
