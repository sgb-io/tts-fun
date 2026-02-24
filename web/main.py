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
import json
import os
import re
import shutil
import tempfile
import uuid
import base64
import logging
from datetime import datetime, timezone
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
    UploadFile,
)
from fastapi.responses import (
    JSONResponse,
    Response,
    StreamingResponse,
)

log = logging.getLogger("tts-fun")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FISH_API_URL = os.environ.get("FISH_API_URL", "http://localhost:8080").rstrip("/")
LLM_URL = os.environ.get("LLM_URL", "http://localhost:11434").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen2.5:7b")
PODCAST_DATA_DIR = Path(os.environ.get("PODCAST_DATA_DIR", "/app/podcast_data"))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="TTS Fun", version="0.1.0")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


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
# Auto-chunking (LLM splits large text into TTS-ready segments)
# ---------------------------------------------------------------------------


class ChunkTextRequest(BaseModel):
    text: str


@app.post("/api/tts/chunk-text")
async def chunk_text_with_llm(req: ChunkTextRequest) -> JSONResponse:
    """Use the local LLM to split a large block of text into natural, TTS-friendly chunks."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    system_msg = (
        "You are a text processing assistant. "
        "Respond with valid JSON only — no markdown, no extra text."
    )
    user_msg = (
        "Split the following text into natural, TTS-friendly chunks. "
        "Each chunk should be 1–4 sentences and end at a natural speech boundary "
        "(end of a sentence or paragraph). "
        "Preserve every word of the original text exactly — do not paraphrase, "
        "summarise, or add anything. "
        "The concatenation of all chunks must equal the original text.\n\n"
        f"Text:\n{req.text}\n\n"
        'Return JSON: {"chunks": ["chunk 1 text", "chunk 2 text", ...]}'
    )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{LLM_URL}/api/chat",
                json={
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                    "stream": False,
                    "format": "json",
                    "options": {
                        "num_predict": 4096,
                        "num_ctx": 8192,
                    },
                },
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="LLM service is not reachable. Ensure the LLM container is running.",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"LLM returned {resp.status_code}: {resp.text[:300]}",
        )

    content = resp.json().get("message", {}).get("content", "")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        log.error("chunk_text LLM returned invalid JSON: %s", content[:500])
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON")

    chunks = parsed.get("chunks", []) if isinstance(parsed, dict) else []
    if not isinstance(chunks, list) or not chunks:
        raise HTTPException(status_code=502, detail="LLM returned no chunks")

    cleaned = [str(c).strip() for c in chunks if str(c).strip()]
    log.info("chunk_text: split into %d chunks", len(cleaned))
    return JSONResponse(content={"chunks": cleaned})


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
            resp = await client.request(
                "DELETE",
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


# ---------------------------------------------------------------------------
# Podcast Creation Tool
# ---------------------------------------------------------------------------

SILENCE_GAP_SECONDS = 0.8  # natural pause between speech turns


# ── Helpers ──────────────────────────────────────────────────────────────────

def _podcast_dir(episode_id: str) -> Path:
    return PODCAST_DATA_DIR / episode_id


def _load_episode(episode_id: str) -> dict:
    path = _podcast_dir(episode_id) / "episode.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Episode not found")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_episode(episode: dict) -> None:
    d = _podcast_dir(episode["id"])
    d.mkdir(parents=True, exist_ok=True)
    (d / "clips").mkdir(exist_ok=True)
    episode["updated_at"] = datetime.now(timezone.utc).isoformat()
    with open(d / "episode.json", "w", encoding="utf-8") as f:
        json.dump(episode, f, indent=2, ensure_ascii=False)


# ── Pydantic models ───────────────────────────────────────────────────────────

class PodcastSpeaker(BaseModel):
    name: str
    bio: str
    voice_id: str


class CreateEpisodeRequest(BaseModel):
    title: str
    speakers: list[PodcastSpeaker]
    prompt: str
    length_minutes: int = 5


class UpdateEpisodeRequest(BaseModel):
    title: str | None = None
    speakers: list[PodcastSpeaker] | None = None
    prompt: str | None = None
    length_minutes: int | None = None
    script: list[dict] | None = None
    phase: int | None = None


# ── Episode CRUD ──────────────────────────────────────────────────────────────

@app.post("/api/podcast/episodes", status_code=201)
async def create_podcast_episode(req: CreateEpisodeRequest) -> JSONResponse:
    """Create a new podcast episode (Phase 1)."""
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not req.speakers or len(req.speakers) > 4:
        raise HTTPException(status_code=400, detail="1–4 speakers required")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    if not (1 <= req.length_minutes <= 60):
        raise HTTPException(status_code=400, detail="length_minutes must be 1–60")

    PODCAST_DATA_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    ep_id = uuid.uuid4().hex[:8]
    episode: dict = {
        "id": ep_id,
        "title": req.title,
        "speakers": [s.model_dump() for s in req.speakers],
        "prompt": req.prompt,
        "length_minutes": req.length_minutes,
        "script": None,
        "phase": 1,
        "final_audio_path": None,
        "transcript": None,
        "created_at": now,
        "updated_at": now,
    }
    _save_episode(episode)
    return JSONResponse(content=episode, status_code=201)


@app.get("/api/podcast/episodes")
async def list_podcast_episodes() -> JSONResponse:
    """List all podcast episodes (summary, newest first)."""
    PODCAST_DATA_DIR.mkdir(parents=True, exist_ok=True)
    episodes = []
    for d in sorted(PODCAST_DATA_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        ep_file = d / "episode.json"
        if d.is_dir() and ep_file.exists():
            with open(ep_file, encoding="utf-8") as f:
                ep = json.load(f)
            episodes.append({
                "id": ep["id"],
                "title": ep["title"],
                "phase": ep.get("phase", 1),
                "length_minutes": ep.get("length_minutes", 5),
                "speakers": ep.get("speakers", []),
                "turn_count": len(ep.get("script") or []),
                "created_at": ep.get("created_at", ""),
                "updated_at": ep.get("updated_at", ""),
            })
    return JSONResponse(content={"episodes": episodes})


@app.get("/api/podcast/episodes/{episode_id}")
async def get_podcast_episode(episode_id: str) -> JSONResponse:
    """Get full episode details including script."""
    return JSONResponse(content=_load_episode(episode_id))


@app.put("/api/podcast/episodes/{episode_id}")
async def update_podcast_episode(episode_id: str, req: UpdateEpisodeRequest) -> JSONResponse:
    """Update episode metadata and/or script."""
    ep = _load_episode(episode_id)
    if req.title is not None:
        ep["title"] = req.title
    if req.speakers is not None:
        ep["speakers"] = [s.model_dump() for s in req.speakers]
    if req.prompt is not None:
        ep["prompt"] = req.prompt
    if req.length_minutes is not None:
        ep["length_minutes"] = req.length_minutes
    if req.script is not None:
        ep["script"] = req.script
    if req.phase is not None:
        ep["phase"] = req.phase
    _save_episode(ep)
    return JSONResponse(content=ep)


@app.delete("/api/podcast/episodes/{episode_id}")
async def delete_podcast_episode(episode_id: str) -> JSONResponse:
    """Delete an episode and all its files."""
    d = _podcast_dir(episode_id)
    if not d.exists():
        raise HTTPException(status_code=404, detail="Episode not found")
    shutil.rmtree(d, ignore_errors=True)
    return JSONResponse(content={"success": True})


# ── Script generation (LLM) ───────────────────────────────────────────────────

@app.post("/api/podcast/episodes/{episode_id}/generate-script")
async def generate_podcast_script(episode_id: str) -> JSONResponse:
    """Call the local LLM to generate a podcast script for the episode."""
    ep = _load_episode(episode_id)
    speakers = ep["speakers"]

    speaker_desc = "\n".join(
        f"  Speaker {i} – {s['name']}: {s['bio']}"
        for i, s in enumerate(speakers)
    )
    # ~130 wpm, ~50 words/turn on average → ~2.6 turns/min; use 3 to be safe
    target_turns = max(10, ep["length_minutes"] * 3)
    target_words = ep["length_minutes"] * 130
    # Rough upper bound on tokens needed: words * 1.4 + JSON overhead
    num_predict = max(4096, int(target_words * 1.6) + 512)

    system_msg = (
        "You are a podcast script writer. "
        "Respond with valid JSON only — no markdown, no extra text."
    )
    user_msg = (
        f"Create a {ep['length_minutes']}-minute podcast script "
        f"(~{target_words} words total, MINIMUM {target_turns} turns).\n\n"
        f"Speakers:\n{speaker_desc}\n\n"
        f"Topic/prompt: {ep['prompt']}\n\n"
        "Rules:\n"
        f"• You MUST produce at least {target_turns} turns — do not stop early\n"
        "• Natural conversation with varied turn lengths (15–150 words each)\n"
        "• Not equally distributed — let it flow like a real podcast\n"
        "• Include reactions, follow-ups, and relevant tangents\n"
        "• Plain spoken words only — no stage directions or markdown\n\n"
        f"Return JSON: {{\"turns\": [{{\"speaker\": 0, \"text\": \"...\"}}, ...]}}\n"
    )
    speaker_index_legend = ", ".join(f"{i}={s['name']}" for i, s in enumerate(speakers))
    user_msg += f"Speaker indices: {speaker_index_legend}"

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{LLM_URL}/api/chat",
                json={
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                    "stream": False,
                    "format": "json",
                    "options": {
                        "num_predict": num_predict,
                        "num_ctx": max(4096, num_predict + 1024),
                    },
                },
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="LLM service is not reachable. Ensure the LLM container is running.",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"LLM returned {resp.status_code}: {resp.text[:300]}",
        )

    content = resp.json().get("message", {}).get("content", "")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        log.error("LLM returned invalid JSON: %s", content[:500])
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON")

    raw_turns = parsed.get("turns", parsed) if isinstance(parsed, dict) else parsed
    if not isinstance(raw_turns, list):
        raise HTTPException(status_code=502, detail="Unexpected LLM response structure")

    script = [
        {
            # LLM uses "speaker" (0-based index); we store as "speaker_index"
            "speaker_index": max(0, min(int(t.get("speaker", 0)), len(speakers) - 1)),
            "text": str(t.get("text", "")).strip(),
            "audio_path": None,
        }
        for t in raw_turns
        if str(t.get("text", "")).strip()
    ]
    if not script:
        raise HTTPException(status_code=502, detail="LLM generated an empty script")

    total_words = sum(len(t["text"].split()) for t in script)
    log.info(
        "Script generated: %d turns, ~%d words (target: %d turns, %d words, num_predict=%d)",
        len(script), total_words, target_turns, target_words, num_predict,
    )

    ep["script"] = script
    _save_episode(ep)
    return JSONResponse(content=ep)


# ── Per-turn clip generation ──────────────────────────────────────────────────

@app.post("/api/podcast/episodes/{episode_id}/clips/{turn_index}")
async def generate_podcast_clip(episode_id: str, turn_index: int) -> JSONResponse:
    """Generate TTS audio for a single script turn and cache it on disk."""
    ep = _load_episode(episode_id)
    script = ep.get("script") or []
    if not (0 <= turn_index < len(script)):
        raise HTTPException(status_code=400, detail="Invalid turn index")

    turn = script[turn_index]
    speaker = ep["speakers"][turn["speaker_index"]]

    payload: dict = {
        "text": turn["text"],
        "format": "wav",
        "temperature": 0.8,
        "top_p": 0.8,
        "repetition_penalty": 1.1,
        "chunk_length": 200,
        "normalize": True,
        "streaming": False,
    }
    if speaker.get("voice_id"):
        payload["reference_id"] = speaker["voice_id"]

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{FISH_API_URL}/v1/tts",
                content=ormsgpack.packb(payload, option=ormsgpack.OPT_SERIALIZE_PYDANTIC),
                headers={"Content-Type": "application/msgpack"},
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Fish Speech API is not reachable.")

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    clips_dir = _podcast_dir(episode_id) / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    (clips_dir / f"{turn_index}.wav").write_bytes(resp.content)

    script[turn_index]["audio_path"] = f"clips/{turn_index}.wav"
    ep["script"] = script
    _save_episode(ep)
    return JSONResponse(content={"success": True, "turn_index": turn_index})


@app.get("/api/podcast/episodes/{episode_id}/clips/{turn_index}")
async def get_podcast_clip(episode_id: str, turn_index: int) -> Response:
    """Stream the cached WAV audio for a single turn."""
    path = _podcast_dir(episode_id) / "clips" / f"{turn_index}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Clip not generated yet")
    return Response(content=path.read_bytes(), media_type="audio/wav")


# ── Episode finalisation ──────────────────────────────────────────────────────

@app.post("/api/podcast/episodes/{episode_id}/finalize")
async def finalize_podcast_episode(episode_id: str) -> JSONResponse:
    """Concatenate all clips (with silence gaps) into the final episode audio."""
    ep = _load_episode(episode_id)
    script = ep.get("script") or []
    if not script:
        raise HTTPException(status_code=400, detail="No script found")

    missing = [i for i, t in enumerate(script) if not t.get("audio_path")]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Audio not yet generated for turns: {missing}",
        )

    ep_dir = _podcast_dir(episode_id)

    # Create a short silence clip used between turns
    silence_path = ep_dir / "silence.wav"
    sil_proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", str(SILENCE_GAP_SECONDS), "-c:a", "pcm_s16le",
        str(silence_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, sil_err = await asyncio.wait_for(sil_proc.communicate(), timeout=30)
    if sil_proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg silence failed: {sil_err.decode()[:200]}",
        )

    # Build a concat demuxer file list
    concat_path = ep_dir / "concat.txt"
    lines = []
    for i in range(len(script)):
        lines.append(f"file '{(ep_dir / 'clips' / f'{i}.wav').resolve()}'")
        if i < len(script) - 1:
            lines.append(f"file '{silence_path.resolve()}'")
    concat_path.write_text("\n".join(lines), encoding="utf-8")

    final_path = ep_dir / "final.wav"
    concat_proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_path),
        "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le",
        str(final_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, c_err = await asyncio.wait_for(concat_proc.communicate(), timeout=300)
    if concat_proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg concat failed: {c_err.decode()[:300]}",
        )

    # Generate transcript
    transcript_lines = [
        f"[{ep['speakers'][t['speaker_index']]['name']}]: {t['text']}"
        for t in script
    ]
    transcript = "\n\n".join(transcript_lines)
    (ep_dir / "transcript.txt").write_text(transcript, encoding="utf-8")

    ep.update(phase=3, final_audio_path="final.wav", transcript=transcript)
    _save_episode(ep)
    return JSONResponse(content={"success": True, "episode": ep})


@app.get("/api/podcast/episodes/{episode_id}/final")
async def get_podcast_final_audio(episode_id: str) -> Response:
    """Download the finalised episode WAV."""
    ep = _load_episode(episode_id)
    path = _podcast_dir(episode_id) / "final.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Final audio not yet generated")
    slug = re.sub(r"[^\w-]", "-", ep.get("title", "episode").lower())[:50].strip("-")
    return Response(
        content=path.read_bytes(),
        media_type="audio/wav",
        headers={"Content-Disposition": f'attachment; filename="{slug}.wav"'},
    )


@app.get("/api/podcast/episodes/{episode_id}/transcript")
async def get_podcast_transcript(episode_id: str) -> Response:
    """Download the episode transcript as plain text."""
    ep = _load_episode(episode_id)
    if not ep.get("transcript"):
        raise HTTPException(status_code=404, detail="Transcript not yet generated")
    slug = re.sub(r"[^\w-]", "-", ep.get("title", "episode").lower())[:50].strip("-")
    return Response(
        content=ep["transcript"].encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-transcript.txt"'},
    )


# ── LLM status ────────────────────────────────────────────────────────────────

@app.get("/api/llm/status")
async def llm_status() -> JSONResponse:
    """Check whether the Ollama LLM service is reachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{LLM_URL}/api/version")
        return JSONResponse({"online": resp.status_code == 200})
    except Exception:
        return JSONResponse({"online": False})
