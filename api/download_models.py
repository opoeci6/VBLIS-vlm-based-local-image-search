import os
from transformers import AutoProcessor, AutoModel

def download_model(model_id: str):
    print(f"\\n--- Downloading {model_id} ---")
    print("This might take a few minutes depending on your internet connection (approx 800MB)...")
    
    try:
        # We set use_fast=False as requested by HF's warning for SigLIP 2
        processor = AutoProcessor.from_pretrained(model_id, use_fast=False)
        print("[OK] Processor downloaded!")
        
        model = AutoModel.from_pretrained(model_id)
        print("[OK] Model weights downloaded!")
        print(f"Successfully cached {model_id} locally.\\n")
        
    except Exception as e:
        print(f"\\n[X] Error downloading {model_id}: {e}")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    models_to_cache = [
        "google/siglip2-base-patch16-224",
        "google/siglip2-base-patch16-naflex",
        "google/siglip2-so400m-patch14-384",
        "google/siglip2-so400m-patch16-naflex",
        "openai/clip-vit-base-patch32"
    ]
    
    print("Starting manual model download script...")
    print(f"Models will be saved to: {os.environ.get('HF_HOME', '~/.cache/huggingface/hub')}")
    
    for m in models_to_cache:
        download_model(m)
        
    print("All downloads complete! You can now start the Electron Dev Server.")
