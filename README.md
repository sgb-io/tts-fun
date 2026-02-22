# 🎙️ TTS Fun

> A self-hosted, fully containerised Text-to-Speech web app powered by
> **[FishAudio-S1-mini](https://huggingface.co/fishaudio/openaudio-s1-mini)** — an open-source 0.5B TTS model with emotion control and voice cloning.

---

## Features

| Feature                | Detail                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| 🗣 High-quality TTS    | FishAudio S1-mini (0.5B) — SOTA open-source TTS                      |
| 🎭 Emotion markers     | `(happy)`, `(whispering)`, `(excited)` and many more                 |
| 🎙 Voice cloning       | Upload a 10–30 s reference clip + transcript                         |
| 🌍 Multilingual        | English, Chinese, Japanese, German, French, Spanish, Korean, Arabic… |
| 🐳 Fully containerised | Zero host-side Python; everything runs in Docker                     |
| ⚡ GPU or CPU          | NVIDIA CUDA GPU (recommended) or CPU-only mode                       |

---

## Quick-start

### 1 — Prerequisites

| Tool                                                                                                                    | Purpose                              |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [Docker Desktop](https://docs.docker.com/get-started/get-docker/) ≥ 26                                                  | Container runtime                    |
| [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) | GPU pass-through (skip for CPU mode) |

> **Windows / WSL2 users:** Docker Desktop with the WSL2 backend already handles GPU pass-through when the NVIDIA Container Toolkit is installed inside WSL2.

---

### 2 — Download the model weights

The model weights (~3 GB) are **not** included in the Docker image; you mount them from the host.

**Windows (PowerShell):**

```powershell
.\download_model.ps1          # uses Docker — no Python required on the host
```

**Linux / macOS / WSL2:**

```bash
bash download_model.sh        # uses Docker — no Python required on the host
```

After the download you should have:

```
checkpoints/
└── openaudio-s1-mini/
    ├── codec.pth
    ├── model.pth
    └── …
```

---

### 3 — Configure (optional)

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

Key settings:

| Variable   | Default  | Notes                                                                                     |
| ---------- | -------- | ----------------------------------------------------------------------------------------- |
| `BACKEND`  | `cuda`   | `cuda` for GPU, `cpu` for CPU-only                                                        |
| `CUDA_VER` | `12.6.0` | Match your NVIDIA driver; see [supported tags](https://hub.docker.com/r/nvidia/cuda/tags) |
| `UV_EXTRA` | `cu126`  | PyTorch CUDA variant: `cu126`, `cu128`, `cu129`, or `cpu`                                 |
| `COMPILE`  | `0`      | `1` enables `torch.compile` (~10× faster, GPU only; first run is slower)                  |
| `WEB_PORT` | `3000`   | Host port for the web UI                                                                  |

---

### 4 — Build and run

```bash
docker compose up --build
```

Open **http://localhost:3000** in your browser.

> The first build downloads and compiles all Python dependencies inside the container (expect 5–15 minutes).  
> Subsequent starts are fast because Docker layer caching is used.

**CPU-only (no GPU):**

```bash
BACKEND=cpu UV_EXTRA=cpu docker compose up --build
```

---

## Usage

### Generate Speech

1. Type your text in the **Generate Speech** tab.  
   Emotion markers are supported: `(happy) Hello!`, `(whispering) this is a secret`.
2. Optionally pick a **reference voice** from the dropdown.
3. Click **Generate** — audio plays automatically.
4. Use **Download** to save the file.

### Clone a Voice

1. Go to the **Clone a Voice** tab.
2. Give your voice a unique **ID** (e.g. `my-voice`).
3. Upload a clean audio clip (10–30 s, WAV or MP3).
4. Paste the **exact transcript** of what is spoken in the clip.
5. Click **Save Voice** — it will appear in the **Generate Speech** voice dropdown.

### Manage Voices

The **Voice Library** tab lists all saved voices and lets you delete them.

---

## Architecture

```
Host
├── checkpoints/          ← model weights (mounted read-only into api container)
├── references/           ← saved voice clips (mounted read-write)
│
Docker Compose
├── tts-fun-api           ← fish-speech API server  (port 8080, internal only)
│   Dockerfile.api          Clones fishaudio/fish-speech v1.5.1
│                           uv sync --extra cu126 (or cpu)
│                           Starts: uv run tools/api_server.py
│
└── tts-fun-web           ← TTS Fun web UI          (port 3000, exposed)
    Dockerfile.web          FastAPI + uvicorn + static HTML/JS
                            Proxies /api/* → fish-speech API
```

---

## Advanced

### Updating fish-speech

The API image pins fish-speech to `v1.5.1`. To use a newer release:

```bash
# Edit Dockerfile.api, change the git clone tag:
#   --branch v1.5.1  →  --branch v<new>
docker compose build api
```

### Enabling torch.compile

```bash
COMPILE=1 docker compose up
```

The first inference will take longer while kernels are compiled; all subsequent runs are ~10× faster.

### Using a different CUDA version

```bash
CUDA_VER=12.8.0 UV_EXTRA=cu128 docker compose up --build
```

Refer to the [CUDA compatibility matrix](https://docs.nvidia.com/deploy/cuda-compatibility/).

---

## Troubleshooting

| Symptom                           | Fix                                                               |
| --------------------------------- | ----------------------------------------------------------------- |
| API status shows **offline**      | The API container may still be loading. Wait 60–90 s and refresh. |
| `CUDA out of memory`              | 12 GB VRAM recommended. Try CPU mode or reduce `chunk_length`.    |
| No audio output                   | Check browser console and Docker logs: `docker compose logs api`  |
| Permission error on `references/` | Run `sudo chown -R 1000:1000 ./references`                        |
| Build fails on `uv sync`          | Check your `CUDA_VER`/`UV_EXTRA` combination and internet access. |

---

## License

The TTS Fun application code in this repository is MIT licensed.  
FishAudio-S1-mini model weights are released under [CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — **non-commercial use only**.  
The fish-speech codebase is [Apache-2.0](https://github.com/fishaudio/fish-speech/blob/main/LICENSE).
