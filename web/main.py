"""
TTS Fun – FastAPI web server.

Sits in front of the Fish Speech API server and provides:
  • A polished browser UI (served from /static)
  • A thin REST API that the UI calls
  • Proxy helpers so the browser never needs to know the internal API URL
"""

from __future__ import annotations

import io
import os
import base64
import logging
from typing import Annotated

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
