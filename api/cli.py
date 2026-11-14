"""The backend's command line.

    main.py                              the desktop backend (what the Windows app starts)
    main.py serve                        the network server alone (Linux, Docker, a headless PC)
    main.py set-password owner|viewer    and the other commands below: change server.json

Every command takes --data-dir. The settings commands run before the backend is imported, so they
work while a server runs (it reads server.json again within a second) and never open the index."""
import argparse
import asyncio
import getpass
import os
import signal
import sys

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
}
_LIGHT_COMMANDS = {
    "set-password", "remove-viewer-password", "add-library-folder", "remove-library-folder",
    "set", "allow-viewer", "sign-out-everywhere", "show-config",
}
_PASSWORD_MESSAGES = {
    "empty": "The password can't be empty.",
    "too_short": "The password needs at least 8 characters.",
    "too_long": "The password can have at most 256 characters.",
    "same_as_other": "The owner and viewer passwords must be different.",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vblis",
        description="VBLIS backend. Without a command it runs for the desktop app.",
    )
    parser.add_argument("--data-dir", help="the data folder (models, index, settings); default: VBLIS_DATA_DIR")
    commands = parser.add_subparsers(dest="command", metavar="command")
    commands.add_parser("serve", help="run the network server alone")
    p = commands.add_parser("set-password", help="set the owner or viewer password")
    p.add_argument("role", choices=["owner", "viewer"])
    p.add_argument("--stdin", action="store_true", help="read the password from standard input")
    commands.add_parser("remove-viewer-password", help="turn viewer sign-in off")
    p = commands.add_parser("add-library-folder", help="allow browsers to index folders inside this one")
    p.add_argument("path")
    p = commands.add_parser("remove-library-folder", help="stop allowing a library folder")
    p.add_argument("path")
    p = commands.add_parser("set", help="change a server setting")
    p.add_argument("name", choices=sorted(SETTABLE))
    p.add_argument("value", help="lists are comma-separated; true/false for switches")
    p = commands.add_parser("allow-viewer", help="what a viewer may do")
    p.add_argument("permission", choices=["originals", "image_search"])
    p.add_argument("value", choices=["on", "off"])
    commands.add_parser("sign-out-everywhere", help="sign every browser out")
    commands.add_parser("show-config", help="print the server settings")
    return parser


def parse(argv):
    """The parsed command line. Sets VBLIS_DATA_DIR first, because importing paths reads it."""
    args = build_parser().parse_args(argv)
    if args.data_dir:
        os.environ["VBLIS_DATA_DIR"] = os.path.abspath(args.data_dir)
    args.light = args.command in _LIGHT_COMMANDS
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
    if field in ("allowed_hosts", "trusted_proxies"):
        data[field] = [part.strip() for part in value.split(",") if part.strip()]
    elif field in ("tls_mode", "cert_file", "key_file"):
        data["tls"][{"tls_mode": "mode"}.get(field, field)] = value
    else:
        data[field] = value
    parsed = server_config.config_from_json(data)
    if parsed.problems:
        raise SystemExit("Not changed: " + "; ".join(parsed.problems))
    return store.update(**{field: getattr(parsed, field)})


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
    print(f"  Owner password: {'set' if config.owner_password else 'NOT SET'}")
    print(f"  Viewer password: {'set' if config.viewer_password else 'not set (viewers can not sign in)'}")
    for name in server_config.VIEWER_PERMISSIONS:
        print(f"  Viewer may use {name}: {'yes' if config.viewer_may(name) else 'no'}")
    if config.env_fields:
        print("  From the environment (VBLIS_SERVER_*): " + ", ".join(sorted(config.env_fields)))
    for problem in config.problems:
        print(f"  Note: {problem}")
    for _code, message in server_config.start_problems(config):
        print(f"  Can't start yet: {message}")


def run_light(args) -> int:
    import server_config

    store = server_config.ServerConfigStore()
    try:
        if args.command != "show-config":
            invalid = store.stored().problems
            if invalid:
                print("Note: these settings in server.json aren't valid and are written back as their defaults:")
                for problem in invalid:
                    print(f"  {problem}")
        if args.command == "set-password":
            _, problem = store.set_password(args.role, _read_password(args.stdin))
            if problem:
                print(_PASSWORD_MESSAGES.get(problem, problem), file=sys.stderr)
                return 1
            print(f"The {args.role} password is set. Browsers signed in as {args.role} have to sign in again.")
        elif args.command == "remove-viewer-password":
            store.clear_password("viewer")
            print("Viewers can no longer sign in.")
        elif args.command == "add-library-folder":
            root = server_config.normalize_root(args.path)
            if root is None:
                print("Give the full path of a folder.", file=sys.stderr)
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
        elif args.command == "allow-viewer":
            store.set_viewer_permission(args.permission, args.value == "on")
            print(f"Viewers {'may' if args.value == 'on' else 'may not'} use {args.permission}.")
        elif args.command == "sign-out-everywhere":
            store.rotate_secret()
            print("Every browser has to sign in again.")
        elif args.command == "show-config":
            show_config(store)
    except server_config.ServerConfigError as e:
        print(str(e), file=sys.stderr)
        return 1
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
            print("Run 'show-config' to see the settings, 'set-password owner' to set a password.", file=sys.stderr)
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
