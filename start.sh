#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install LTS from https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "Edit .env and set MEET_URL to your open Meet link, then run ./start.sh again."
  exit 1
fi

echo "Starting one CHAT_ONLY Meet guest..."
exec node scripts/run-one-bot.js
