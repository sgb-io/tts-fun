#!/usr/bin/env bash
# download_model.sh — Download FishAudio-S1-mini weights into ./checkpoints
#
# Usage:
#   bash download_model.sh            # uses Docker (recommended, no local Python needed)
#   bash download_model.sh --local    # uses a locally installed `uv` / Python

set -euo pipefail

MODEL_ID="fishaudio/openaudio-s1-mini"
LOCAL_DIR="./checkpoints/openaudio-s1-mini"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  TTS Fun – Model Downloader                          ║"
echo "║  Model : ${MODEL_ID}         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo

mkdir -p "$LOCAL_DIR"

if [[ "${1:-}" == "--local" ]]; then
  # ── Local path (requires uv + huggingface_hub on the host) ──────────────
  echo "▶ Downloading via local uv (host Python)…"
  if ! command -v uv &>/dev/null; then
    echo "ERROR: 'uv' not found. Install it from https://docs.astral.sh/uv/ or run without --local."
    exit 1
  fi
  uv tool run huggingface_hub download \
    "$MODEL_ID" \
    --local-dir "$LOCAL_DIR"
else
  # ── Docker path (no host Python required) ────────────────────────────────
  echo "▶ Downloading via Docker (no host Python required)…"
  docker run --rm \
    -v "$(pwd)/checkpoints:/checkpoints" \
    -e HF_HUB_ENABLE_HF_TRANSFER=1 \
    ghcr.io/astral-sh/uv:0.8.15 \
    sh -c "
      uv tool install 'huggingface_hub[hf_transfer]' --quiet &&
      huggingface-cli download ${MODEL_ID} --local-dir /checkpoints/openaudio-s1-mini
    "
fi

echo
echo "✅  Done!  Weights saved to: ${LOCAL_DIR}"
echo
echo "Next step:"
echo "  docker compose up --build"
