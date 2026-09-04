Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 20+ is required. Install LTS from https://nodejs.org"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "A instalar dependencias..."
  npm install
}

if (-not (Test-Path "user-data")) {
  New-Item -ItemType Directory -Path "user-data" | Out-Null
}

$env:PLATEIA_PORT = if ($env:PLATEIA_PORT) { $env:PLATEIA_PORT } else { "8787" }
Write-Host "Plateia Console em http://127.0.0.1:$($env:PLATEIA_PORT)"
Start-Process "http://127.0.0.1:$($env:PLATEIA_PORT)"
node console/index.js
