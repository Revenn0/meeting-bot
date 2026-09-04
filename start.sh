#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install LTS from https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "A instalar dependências..."
  npm install
fi

mkdir -p user-data
export PLATEIA_PORT="${PLATEIA_PORT:-8787}"
echo "Plateia Console em http://127.0.0.1:${PLATEIA_PORT}"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:${PLATEIA_PORT}" >/dev/null 2>&1 || true
fi
exec node console/index.js
