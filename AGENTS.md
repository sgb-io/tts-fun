# AGENTS.md — guidance for AI coding agents

This file describes the project structure, conventions, and constraints for any
AI agent working in this repository.

---

## Project overview

**TTS Fun** is a self-hosted, fully containerised Text-to-Speech web application
built on top of [FishAudio-S1-mini](https://huggingface.co/fishaudio/openaudio-s1-mini)
(a 0.5B open-source TTS model). It has four runtime components:

| Container          | Source                        | Purpose                                          |
| ------------------ | ----------------------------- | ------------------------------------------------ |
| `tts-fun-llm`      | `Dockerfile.llm`              | Ollama LLM server for podcast script generation  |
| `tts-fun-api`      | `Dockerfile.api`              | Runs the upstream fish-speech HTTP API server    |
| `tts-fun-web`      | `Dockerfile.web`              | FastAPI backend that wraps the API and LLM       |
| `tts-fun-frontend` | `frontend/Dockerfile.frontend`| Next.js frontend served to the browser           |

The user interacts with the Next.js frontend (port 3000), which proxies `/api/*`
requests to the FastAPI backend (port 8000). The backend in turn talks to the
fish-speech API (port 8080) and the Ollama LLM (port 11434), both internal to
the Docker network.

---

## Repository layout

```
tts-fun/
├── Dockerfile.api          # fish-speech API server image
├── Dockerfile.llm          # Ollama LLM server image
├── Dockerfile.web          # FastAPI backend image
├── docker-compose.yml      # Orchestrates all four containers
├── .env.example            # Template for .env (BACKEND, CUDA_VER, LLM_MODEL, etc.)
├── download_model.ps1      # Windows: download model weights via Docker/uv
├── download_model.sh       # Linux/macOS: same
├── tools/
│   └── download_model.py   # Python script used by both download scripts
├── frontend/               # Next.js UI (TypeScript, served on port 3000)
│   ├── Dockerfile.frontend
│   └── src/
├── web/
│   ├── main.py             # FastAPI application (all routes)
│   ├── pyproject.toml      # Python dependencies (managed by uv)
│   └── static/             # Legacy static assets
├── podcast_data/           # Podcast episode data mount point (gitignored)
├── checkpoints/            # Model weights mount point (gitignored, not in image)
└── references/             # Voice clone clips mount point (gitignored)
```

---

## Key conventions

### Python tooling — uv everywhere

- **All Python dependency management uses `uv`**, both inside containers and in
  helper scripts. Never use `pip install` directly.
- The web app's dependencies are declared in [web/pyproject.toml](web/pyproject.toml).
  To add a dependency: edit `pyproject.toml` and let Docker regenerate the lockfile
  on the next build (`uv lock && uv sync` runs in `Dockerfile.web`).
- Running locally (outside Docker) for development: `cd web && uv sync && uv run uvicorn main:app --reload`

### No host-side Python

The project is designed to require **zero Python on the host machine**. Model
downloads, container builds, and all runtime execution happen inside Docker. Do
not add instructions or scripts that require host Python.

### Containers

- `Dockerfile.api` clones [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)
  at **main** rather than a pinned tag, because the openaudio-s1-mini model weights
  require fields added after the v1.5.1 release.
- `Dockerfile.web` uses `python:3.12-slim` with uv. It does **not** clone any
  external repo — only the files in `web/` are copied in.
- `Dockerfile.llm` wraps the official Ollama image; the configured model is pulled
  on first start and cached in the `ollama_data` volume.
- `frontend/Dockerfile.frontend` builds the Next.js app. Set `NEXT_MODE=dev` in
  `.env` for hot-reload development mode.
- GPU support is handled via the `deploy.resources.reservations` block in
  `docker-compose.yml`. CPU-only mode is selected with `BACKEND=cpu`.

### Frontend

- The UI is a **Next.js application** (`frontend/`) — TypeScript, React, no custom
  build config beyond `next.config.ts`.
- All API calls from the browser hit `/api/*` on the Next.js container, which
  rewrites them to the FastAPI backend (`web/`) over the internal Docker network.
- For development with hot-reload, set `NEXT_MODE=dev` in `.env` and optionally
  add a volume mount for `./frontend/src:/app/src` in `docker-compose.yml`.

### fish-speech API contract

The upstream API uses **msgpack** by default. The web backend (`web/main.py`)
uses `ormsgpack` to serialise requests to `/v1/tts` and passes
`Content-Type: application/msgpack`. Reference management endpoints
(`/v1/references/*`) use `multipart/form-data` for uploads and accept
`application/json` for responses.

Key upstream endpoints used:

- `POST /v1/tts` — generate audio (`ServeTTSRequest` schema)
- `POST /v1/references/add` — upload a reference voice
- `GET  /v1/references/list` — list saved voices
- `DELETE /v1/references/delete` — remove a voice
- `GET  /v1/health` — health check

### LLM / Podcast API contract

The web backend talks to Ollama at `http://llm:11434` (configurable via `LLM_URL`).
The model used for podcast script generation is set by `LLM_MODEL` (default:
`qwen2.5:7b`). Relevant backend routes are under `/api/podcast`.

---

## Things to watch out for

- **`hf_access_token.txt`** exists in the repo root and is gitignored. Never
  commit it or log its contents.
- **`checkpoints/`** contains large binary model files and is gitignored. Never
  try to add these to the image or commit them.
- **`podcast_data/`** is gitignored and used as a volume mount for episode JSON,
  audio clips, and final audio output.
- **PowerShell 5.1 compatibility** — the host is Windows. Any `.ps1` scripts must
  work in PowerShell 5.1 (not just PS 7). Avoid `&&` pipeline chains, non-ASCII
  characters without a UTF-8 BOM, and backtick line-continuations with trailing spaces.
- **Shell commands in Docker arguments** — pass Docker arguments as PowerShell
  arrays (`$args = @(...); & docker @args`) rather than with backtick
  line-continuation. Pass dynamic values as `-e KEY=VALUE` env vars rather than
  interpolating them into shell strings.

---

## How to verify changes

```powershell
# Build and start everything
docker compose up --build

# Tail logs for a specific service
docker compose logs -f llm
docker compose logs -f api
docker compose logs -f web
docker compose logs -f frontend

# Check the web UI
Start-Process "http://localhost:3000"

# Check the fish-speech API directly
Invoke-RestMethod http://localhost:8080/v1/health
```

There are no automated tests at present. Manual smoke tests:

1. Open the UI, generate speech with the default text — audio should play.
2. Clone a voice (upload any short WAV + transcript), then use it in generation.
3. Delete the voice from the Voice Library tab.
4. Generate a podcast episode from the Podcast tab — script and audio should be produced.
