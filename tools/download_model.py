"""
Download FishAudio-S1-mini model weights via huggingface_hub snapshot_download.
Reads MODEL_ID and LOCAL_DIR from environment variables.

Run via uv (no prior install needed):
  uv run --with huggingface_hub python tools/download_model.py
"""
import os
import sys

from huggingface_hub import snapshot_download

model_id = os.environ.get("MODEL_ID", "fishaudio/openaudio-s1-mini")
local_dir = os.environ.get("LOCAL_DIR", "/checkpoints/openaudio-s1-mini")
token = os.environ.get("HF_TOKEN") or None

print(f"Downloading model  : {model_id}")
print(f"Destination        : {local_dir}")
print(f"Authenticated      : {'yes' if token else 'no (may fail for gated models)'}")
print()

try:
    snapshot_download(
        repo_id=model_id,
        repo_type="model",
        local_dir=local_dir,
        token=token,
    )
    print()
    print("Download complete.")
except Exception as exc:
    print(f"\nERROR: {exc}", file=sys.stderr)
    sys.exit(1)
