#!/bin/bash
# start_llm.sh — Start Ollama, pull the configured model if needed, then serve.
set -euo pipefail

MODEL="${LLM_MODEL:-qwen2.5:7b}"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" >&2; }

log "Starting Ollama LLM server (model: ${MODEL})..."

# Start Ollama in the background
ollama serve &
SERVE_PID=$!

# Wait until Ollama's HTTP API is ready (up to 60 s)
log "Waiting for Ollama to initialise..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:11434/api/version > /dev/null 2>&1; then
        log "Ollama is ready."
        break
    fi
    sleep 2
done

# Pull the model if it is not already cached in the volume
if ! ollama list 2>/dev/null | grep -qF "${MODEL}"; then
    log "Model '${MODEL}' not found locally. Pulling (this may take a while on first start)..."
    ollama pull "${MODEL}"
    log "Model '${MODEL}' ready."
else
    log "Model '${MODEL}' already present."
fi

log "LLM server fully ready."

# Hand off to the Ollama process
wait $SERVE_PID
