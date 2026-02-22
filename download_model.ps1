# download_model.ps1 - Download FishAudio-S1-mini weights into .\checkpoints
# For Windows users (PowerShell)
#
# Usage:
#   .\download_model.ps1            # uses Docker (recommended)
#   .\download_model.ps1 -Local     # uses a locally installed uv

param(
    [switch]$Local
)

$ErrorActionPreference = "Stop"

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
    # Uses the uv+Python bundled image so uv is in PATH; entrypoint overridden to sh.
    # uvx (uv tool run) installs and runs huggingface-cli in one step -- no pip needed.
    Write-Host "Downloading via Docker using uv (no host Python required)..." -ForegroundColor Yellow

    $AbsCheckpoints = (Resolve-Path ".\checkpoints").Path

    $ShellCmd = "uvx --from huggingface_hub hf download $ModelId --local-dir /checkpoints/openaudio-s1-mini"

    $DockerArgs = @(
        "run", "--rm",
        "--entrypoint", "sh",
        "-v", "${AbsCheckpoints}:/checkpoints",
        "ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm",
        "-c", $ShellCmd
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
