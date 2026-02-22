# AGENTS.md — guidance for AI coding agents

This file describes the project structure, conventions, and constraints for any
AI agent working in this repository.

---

## Project overview

**TTS Fun** is a self-hosted, fully containerised Text-to-Speech web application
built on top of [FishAudio-S1-mini](https://huggingface.co/fishaudio/openaudio-s1-mini)
(a 0.5B open-source TTS model). It has two runtime components:

| Container     | Source           | Purpose                                       |
| ------------- | ---------------- | --------------------------------------------- |
| `tts-fun-api` | `Dockerfile.api` | Runs the upstream fish-speech HTTP API server |
| `tts-fun-web` | `Dockerfile.web` | Custom FastAPI web UI that wraps the API      |

The user interacts only with the web UI (port 3000). The API server (port 8080)
is internal to the Docker network.

---

## Repository layout

```
tts-fun/
├── Dockerfile.api          # fish-speech API server image (clones v1.5.1, uv sync)
├── Dockerfile.web          # TTS Fun web UI image (FastAPI + uvicorn)
├── docker-compose.yml      # Orchestrates both containers
├── .env.example            # Template for .env (BACKEND, CUDA_VER, COMPILE, etc.)
├── download_model.ps1      # Windows: download model weights via Docker/uv
├── download_model.sh       # Linux/macOS: same
├── tools/
│   └── download_model.py   # Python script used by both download scripts
├── web/
│   ├── main.py             # FastAPI application (all routes)
│   ├── pyproject.toml      # Python dependencies (managed by uv)
│   └── static/
│       └── index.html      # Single-page UI (vanilla JS, no build step)
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
  require fields (e.g. `attention_o_bias`) added after the v1.5.1 release. To pin to a
  specific release once a compatible tag ships, change the clone command in `Dockerfile.api`.
- `Dockerfile.web` uses `python:3.12-slim` with uv installed from
  `ghcr.io/astral-sh/uv:0.8.15`. It does **not** clone any external repo —
  only the files in `web/` are copied in.
- GPU support is handled via the `deploy.resources.reservations` block in
  `docker-compose.yml`. CPU-only mode is selected with `BACKEND=cpu`.

### Frontend

- The UI is a **single HTML file** (`web/static/index.html`) with vanilla JS and
  inline CSS — no framework, no build step, no bundler.
- All API calls from the browser go to `/api/*` on the web container (FastAPI),
  which proxies to the fish-speech API over the internal Docker network.
- Keep the frontend self-contained in `index.html`. Only add a build step if
  complexity genuinely demands it.

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

---

## Things to watch out for

- **`hf_access_token.txt`** exists in the repo root and is gitignored. Never
  commit it or log its contents.
- **`checkpoints/`** contains large binary model files and is gitignored. Never
  try to add these to the image or commit them.
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
docker compose logs -f api
docker compose logs -f web

# Check the web UI
Start-Process "http://localhost:3000"

# Check the API directly
Invoke-RestMethod http://localhost:8080/v1/health
```

There are no automated tests at present. Manual smoke tests:

1. Open the UI, generate speech with the default text — audio should play.
2. Clone a voice (upload any short WAV + transcript), then use it in generation.
3. Delete the voice from the Voice Library tab.
