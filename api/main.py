import sys

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    # The settings commands run before the backend is imported (which opens the index), so they
    # also work while a server is running
    import cli
    _args = cli.parse(sys.argv[1:])
    if _args.light:
        sys.exit(cli.run_light(_args))

from contextlib import asynccontextmanager

from fastapi import FastAPI

# Importing app_state runs bootstrap (env, HF_HOME, data migration) before anything loads transformers
import app_state
import paths
import security
from bootstrap import API_TOKEN
from network_listener import NetworkListener
from routers import indexing, media, models, queue, search, settings

# Shares the library on the network next to the desktop app, when the settings say so
network_listener = NetworkListener(app_state.server_config, web_dir=paths.WEB_DIR)
app_state.network_listener = network_listener


@asynccontextmanager
async def desktop_lifespan(app):
    async with app_state.lifespan(app):
        # Sharing is optional: nothing about it may stop the desktop app from starting
        try:
            if app_state.server_config.current().enabled:
                for _code, message in await network_listener.start():
                    print(f"[Network] Not sharing on the network: {message}")
        except Exception as e:  # noqa: BLE001
            print(f"[Network] Not sharing on the network: {e!r}")
        try:
            yield
        finally:
            await network_listener.stop()


app = FastAPI(title="Local Image Search API", lifespan=desktop_lifespan)

# Only clients holding the token (the Electron app passes it via env) may call the API
security.install(app, API_TOKEN)

for _module in (settings, search, indexing, queue, models, media):
    app.include_router(_module.router)

if __name__ == "__main__":
    sys.exit(cli.run_backend(_args, app))
