"""The models VBLIS offers. A module of its own so the import and export commands can check a model id
without loading the model stack (model_manager imports torch and transformers)."""

# The only models the API will download, switch to or delete
AVAILABLE_MODELS = (
    "google/siglip2-base-patch16-224",
    "google/siglip2-base-patch16-naflex",
    "google/siglip2-so400m-patch14-384",
    "google/siglip2-so400m-patch16-naflex",
    "openai/clip-vit-base-patch32",
)
