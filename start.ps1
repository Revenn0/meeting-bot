Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 20+ is required. Install LTS from https://nodejs.org"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
  Write-Host "Edit .env and set MEET_URL to your open Meet link, then run start.ps1 again."
  exit 1
}

Write-Host "Starting one CHAT_ONLY Meet guest..."
node scripts/run-one-bot.js
