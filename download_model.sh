#!/usr/bin/env bash
# download_model.sh - Download FishAudio-S1-mini weights into ./checkpoints
#
# Usage:
#   bash download_model.sh            # uses Docker (recommended, no local Python needed)
#   bash download_model.sh --local    # uses a locally installed uv / Python
#
# Prerequisites:
#   1. Accept the model licence at https://huggingface.co/fishaudio/openaudio-s1-mini
#   2. Have a Hugging Face token ready (https://huggingface.co/settings/tokens)
#      Set HF_TOKEN env var or the script will prompt for it.

set -euo pipefail

MODEL_ID="fishaudio/openaudio-s1-mini"
LOCAL_DIR="./checkpoints/openaudio-s1-mini"

echo ""
echo "================================================"
echo "  TTS Fun - Model Downloader"
echo "  Model: ${MODEL_ID}"
echo "================================================"
echo ""

# Prompt for token if not already set
if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "A Hugging Face token is required (the model is gated)."
  echo "Get yours at: https://huggingface.co/settings/tokens"
  echo ""
  read -rsp "HF Token: " HF_TOKEN
  echo ""
  if [[ -z "$HF_TOKEN" ]]; then
    echo "ERROR: No token provided. Aborting."
    exit 1
  fi
fi

mkdir -p "$LOCAL_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--local" ]]; then
  # Local path (requires uv on the host)
  echo "Downloading via local uv (host Python)..."
  if ! command -v uv &>/dev/null; then
    echo "ERROR: 'uv' not found. Install it from https://docs.astral.sh/uv/ or run without --local."
    exit 1
  fi
  HF_TOKEN="$HF_TOKEN" uv run --with huggingface_hub python "${SCRIPT_DIR}/tools/download_model.py"
else
  # Docker path (no host Python required)
  echo "Downloading via Docker using uv (no host Python required)..."
  ABS_CHECKPOINTS="$(cd "$(dirname "$LOCAL_DIR")" && pwd)/$(basename "$LOCAL_DIR")/.."
  ABS_CHECKPOINTS="$(cd "$(pwd)/checkpoints" && pwd)"
  docker run --rm \
    --entrypoint uv \
    -v "${ABS_CHECKPOINTS}:/checkpoints" \
    -v "${SCRIPT_DIR}/tools/download_model.py:/download_model.py:ro" \
    -e "MODEL_ID=${MODEL_ID}" \
    -e "LOCAL_DIR=/checkpoints/openaudio-s1-mini" \
    -e "HF_TOKEN=${HF_TOKEN}" \
    ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm \
    run --with huggingface_hub python /download_model.py
fi

echo ""
echo "Done! Weights saved to: ${LOCAL_DIR}"
echo ""
echo "Next step:"
echo "  docker compose up --build"
echo ""
