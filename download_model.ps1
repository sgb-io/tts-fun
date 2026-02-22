# download_model.ps1 - Download FishAudio-S1-mini weights into .\checkpoints
# For Windows users (PowerShell)
#
# Usage:
#   .\download_model.ps1            # uses Docker (recommended)
#   .\download_model.ps1 -Local     # uses a locally installed uv

param(
    [switch]$Local,
    [string]$Token = $env:HF_TOKEN
)

$ErrorActionPreference = "Stop"

# Prompt for token if not provided - required for gated models like openaudio-s1-mini
if (-not $Token) {
    Write-Host "A Hugging Face token is required (the model is gated)." -ForegroundColor Yellow
    Write-Host "Get yours at: https://huggingface.co/settings/tokens" -ForegroundColor Yellow
    Write-Host ""
    $TokenSecure = Read-Host "HF Token" -AsSecureString
    $Token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($TokenSecure)
    )
    if (-not $Token) {
        Write-Error "No token provided. Aborting."
        exit 1
    }
}

$ModelId   = "fishaudio/openaudio-s1-mini"
$LocalDir  = ".\checkpoints\openaudio-s1-mini"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  TTS Fun - Model Downloader" -ForegroundColor Cyan
Write-Host "  Model: $ModelId" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

if ($Local) {
    # Local path -- requires uv installed on the host
    Write-Host "Downloading via local uv (host Python)..." -ForegroundColor Yellow
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Write-Error "'uv' not found. Install it from https://docs.astral.sh/uv/ or run without -Local."
        exit 1
    }
    uv tool run huggingface_hub download $ModelId --local-dir $LocalDir
} else {
    # Docker path -- no host Python required.
    # Mounts tools/download_model.py into the container and runs it with uv directly
    # as the entrypoint -- no sh, no shell quoting, no CLI quirks.
    Write-Host "Downloading via Docker using uv (no host Python required)..." -ForegroundColor Yellow

    $AbsCheckpoints  = (Resolve-Path ".\checkpoints").Path
    $AbsDownloadScript = (Resolve-Path ".\tools\download_model.py").Path

    $DockerArgs = @(
        "run", "--rm",
        "--entrypoint", "uv",
        "-v", "${AbsCheckpoints}:/checkpoints",
        "-v", "${AbsDownloadScript}:/download_model.py:ro",
        "-e", "MODEL_ID=$ModelId",
        "-e", "LOCAL_DIR=/checkpoints/openaudio-s1-mini",
        "-e", "HF_TOKEN=$Token",
        "ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm",
        "run", "--with", "huggingface_hub", "python", "/download_model.py"
    )

    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Error "Download failed (docker exited with code $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "Done! Weights saved to: $LocalDir" -ForegroundColor Green
Write-Host ""
Write-Host "Next step:"
Write-Host "  docker compose up --build" -ForegroundColor Cyan
