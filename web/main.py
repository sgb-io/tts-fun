"""
TTS Fun – FastAPI web server.

Sits in front of the Fish Speech API server and provides:
  • A polished browser UI (served from /static)
  • A thin REST API that the UI calls
  • Proxy helpers so the browser never needs to know the internal API URL
"""

from __future__ import annotations

import asyncio
import io
import os
import re
import shutil
import tempfile
import base64
import logging
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel

import httpx
import ormsgpack
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("tts-fun")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FISH_API_URL = os.environ.get("FISH_API_URL", "http://localhost:8080").rstrip("/")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="TTS Fun", version="0.1.0")

# Serve static assets (the SPA)
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
    name="static",
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Root – serve the SPA
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def root(request: Request) -> HTMLResponse:
    index_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    with open(index_path, encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


# ---------------------------------------------------------------------------
# TTS generation
# ---------------------------------------------------------------------------


@app.post("/api/tts")
async def generate_tts(
    text: Annotated[str, Form()],
    reference_id: Annotated[str | None, Form()] = None,
    format: Annotated[str, Form()] = "wav",
    temperature: Annotated[float, Form()] = 0.8,
    top_p: Annotated[float, Form()] = 0.8,
    repetition_penalty: Annotated[float, Form()] = 1.1,
    chunk_length: Annotated[int, Form()] = 200,
    normalize: Annotated[bool, Form()] = True,
    seed: Annotated[int | None, Form()] = None,
) -> Response:
    """Generate TTS audio and return it directly to the browser."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    payload: dict = {
        "text": text,
        "format": format,
        "temperature": temperature,
        "top_p": top_p,
        "repetition_penalty": repetition_penalty,
        "chunk_length": chunk_length,
        "normalize": normalize,
        "streaming": False,
    }
    if reference_id:
        payload["reference_id"] = reference_id
    if seed is not None:
        payload["seed"] = seed

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{FISH_API_URL}/v1/tts",
                content=ormsgpack.packb(payload, option=ormsgpack.OPT_SERIALIZE_PYDANTIC),
                headers={"Content-Type": "application/msgpack"},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        content_type = {
            "wav": "audio/wav",
            "mp3": "audio/mpeg",
            "pcm": "audio/pcm",
        }.get(format, "audio/wav")

        return Response(
            content=resp.content,
            media_type=content_type,
            headers={"Content-Disposition": f"attachment; filename=output.{format}"},
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Fish Speech API is not reachable. Make sure the API container is running.",
        )


# ---------------------------------------------------------------------------
# Voice cloning – upload reference audio
# ---------------------------------------------------------------------------


@app.post("/api/references/add")
async def add_reference(
    id: Annotated[str, Form()],
    text: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
) -> JSONResponse:
    """Upload a reference voice (audio + transcript) to the API server."""
    audio_bytes = await audio.read()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{FISH_API_URL}/v1/references/add",
                data={"id": id, "text": text},
                files={"audio": (audio.filename, io.BytesIO(audio_bytes), audio.content_type or "audio/wav")},
                headers={"Accept": "application/json"},
            )
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        return JSONResponse(content=data, status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Fish Speech API is not reachable.")


@app.get("/api/references/list")
async def list_references() -> JSONResponse:
    """List all saved reference voice IDs."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{FISH_API_URL}/v1/references/list",
                headers={"Accept": "application/json"},
            )
        return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Fish Speech API is not reachable.")


@app.delete("/api/references/{reference_id}")
async def delete_reference(reference_id: str) -> JSONResponse:
    """Delete a saved reference voice."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(
                f"{FISH_API_URL}/v1/references/delete",
                content=ormsgpack.packb({"reference_id": reference_id}),
                headers={
                    "Content-Type": "application/msgpack",
                    "Accept": "application/json",
                },
            )
        return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Fish Speech API is not reachable.")


# ---------------------------------------------------------------------------
# YouTube voice clone
# ---------------------------------------------------------------------------

MAX_CLIP_SECONDS = 30
YT_DOWNLOAD_TIMEOUT = 180  # seconds


class YouTubeCloneRequest(BaseModel):
    url: str


def _slugify_title(title: str, max_len: int = 40) -> str:
    """Turn a video title into a short kebab-case voice ID."""
    # Take first 5 words, strip non-alphanumeric chars
    words = re.split(r'[\s\-_]+', title.strip())[:5]
    slug = '-'.join(re.sub(r'[^a-zA-Z0-9]', '', w).lower() for w in words if w)
    slug = re.sub(r'-+', '-', slug).strip('-')[:max_len]
    return slug or 'yt-voice'


def _parse_srt(srt_text: str, max_seconds: float = 30.0) -> str:
    """
    Extract plain transcript from SRT, only including cues that START
    before *max_seconds*. Handles YouTube auto-generated caption quirks
    (HTML tags, duplicate rolling lines).
    """
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    lines: list[str] = []
    seen: set[str] = set()

    for block in blocks:
        block_lines = [ln.strip() for ln in block.strip().splitlines()]
        ts_idx = None
        start_s = 0.0
        for i, ln in enumerate(block_lines):
            m = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d+)\s*-->', ln)
            if m:
                ts_idx = i
                start_s = (
                    int(m.group(1)) * 3600
                    + int(m.group(2)) * 60
                    + int(m.group(3))
                    + int(m.group(4)) / 1000
                )
                break
        if ts_idx is None or start_s >= max_seconds:
            continue
        raw = ' '.join(block_lines[ts_idx + 1:])
        # Strip HTML / VTT inline tags such as <c>, <i>, <00:00:01.234>, </c>
        raw = re.sub(r'<[^>]+>', '', raw)
        raw = re.sub(r'\s+', ' ', raw).strip()
        if raw and raw not in seen:
            seen.add(raw)
            lines.append(raw)

    return ' '.join(lines)


@app.post('/api/youtube-clone')
async def youtube_clone(req: YouTubeCloneRequest) -> JSONResponse:
    """Download a YouTube video's audio (first 30 s) + captions and add as a voice."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail='url is required')
    if not re.search(r'(youtube\.com|youtu\.be)', url):
        raise HTTPException(status_code=400, detail='URL does not look like a YouTube URL')

    tmpdir = tempfile.mkdtemp(prefix='yttts_')
    try:
        out_tmpl = os.path.join(tmpdir, '%(title)s [%(id)s]')
        proc = await asyncio.create_subprocess_exec(
            'yt-dlp',
            '-x', '--audio-format', 'mp3',
            '--write-auto-sub', '--sub-lang', 'en', '--convert-subs', 'srt',
            '--no-playlist', '--no-warnings', '--max-filesize', '100m',
            '-o', out_tmpl,
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=YT_DOWNLOAD_TIMEOUT
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail='Download timed out after 3 minutes')

        if proc.returncode != 0:
            err = stderr.decode(errors='replace')
            log.error('yt-dlp failed: %s', err)
            detail = err.splitlines()[-1] if err.strip() else f'yt-dlp exited {proc.returncode}'
            raise HTTPException(status_code=422, detail=detail[:400])

        mp3_files = list(Path(tmpdir).glob('*.mp3'))
        srt_files = (
            list(Path(tmpdir).glob('*.en.srt'))
            or list(Path(tmpdir).glob('*.srt'))
        )

        if not mp3_files:
            raise HTTPException(status_code=422, detail='No audio file found after download')
        if not srt_files:
            raise HTTPException(
                status_code=422,
                detail='No captions found. Make sure the video has English auto-generated captions.',
            )

        mp3_path = mp3_files[0]
        voice_id = _slugify_title(re.sub(r'\s*\[[\w-]+\]$', '', mp3_path.stem))

        # Trim audio to MAX_CLIP_SECONDS using ffmpeg
        trimmed = os.path.join(tmpdir, 'trimmed.mp3')
        trim = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-i', str(mp3_path),
            '-t', str(MAX_CLIP_SECONDS), '-acodec', 'copy',
            trimmed,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, trim_err = await asyncio.wait_for(trim.communicate(), timeout=60)
        if trim.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail='ffmpeg trim failed: ' + trim_err.decode(errors='replace')[:200],
            )

        transcript = _parse_srt(
            srt_files[0].read_text(encoding='utf-8', errors='replace'),
            max_seconds=float(MAX_CLIP_SECONDS),
        )
        if not transcript:
            raise HTTPException(
                status_code=422,
                detail='Could not extract transcript text from captions.',
            )

        with open(trimmed, 'rb') as f:
            audio_bytes = f.read()

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f'{FISH_API_URL}/v1/references/add',
                data={'id': voice_id, 'text': transcript},
                files={'audio': ('trimmed.mp3', io.BytesIO(audio_bytes), 'audio/mpeg')},
                headers={'Accept': 'application/json'},
            )
        data = (
            resp.json()
            if resp.headers.get('content-type', '').startswith('application/json')
            else {}
        )
        if not (resp.status_code == 200 and data.get('success')):
            raise HTTPException(
                status_code=resp.status_code,
                detail=data.get('message', f'API error {resp.status_code}'),
            )
        return JSONResponse({'success': True, 'id': voice_id, 'transcript': transcript})

    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail='Fish Speech API is not reachable.')
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# API status proxy
# ---------------------------------------------------------------------------


@app.get("/api/status")
async def api_status() -> JSONResponse:
    """Check whether the Fish Speech API server is reachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{FISH_API_URL}/v1/health")
        return JSONResponse({"online": resp.status_code == 200})
    except Exception:
        return JSONResponse({"online": False})
