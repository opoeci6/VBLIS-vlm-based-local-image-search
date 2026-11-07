import uvicorn
from fastapi import FastAPI

# Importing app_state runs bootstrap (env, HF_HOME, data migration) before anything loads transformers
import app_state
import security
from bootstrap import API_TOKEN
from routers import indexing, media, models, queue, search, settings

app = FastAPI(title="Local Image Search API", lifespan=app_state.lifespan)

# Only clients holding the token (the Electron app passes it via env) may call the API
security.install(app, API_TOKEN)

for _module in (settings, search, indexing, queue, models, media):
    app.include_router(_module.router)

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    import parent_watch
    parent_watch.start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
