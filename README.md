# Meeting Bot

A headless browser bot that joins Google Meet, pushes local video/audio files as fake camera/mic input, and records the meeting's remote streams to disk. Runs inside a single Docker container.

## Features

- **Headless join** — bot joins Meet automatically as a guest
- **Bi-directional media** — pushes local `.y4m` video and `.wav` audio as fake camera/mic; records remote participants' audio + video to `.webm`
- **Native Chromium pipeline** — uses Chromium's built-in `--use-file-for-fake-*-capture` flags and a `RTCPeerConnection` hook to access remote tracks (no third-party media stack)
- **Single Docker container** — `docker compose up` and the bot joins

## Architecture

```
Node.js (bot.js)
  ↓ Puppeteer
Chromium (headless, in Docker, with Xvfb virtual display)
  ↓ navigates to meet.google.com/<code>
  ↓ injects RTCPeerConnection wrapper before page JS runs
  ↓ pushes fake_video.y4m + fake_audio.wav as camera/mic
  ↓ joins as guest, host admits
  ↓ remote tracks captured by hook → MediaStream
  ↓ MediaRecorder → webm chunks
  ↓ exposeFunction → Node writes recording.webm
```

See `DESIGN.md` for design rationale and trade-offs.

## Prerequisites

- Docker Desktop (or compatible engine)
- A Google Meet room (use any Google account to create one — keep the host tab open during the demo)
- A short source video file (`.mp4`, 10–30 seconds) to convert to fake media

## Quick start

```bash
# 1. Prepare fake media files from your source video
mkdir -p media output
ffmpeg -i your_source.mp4 -t 10 -pix_fmt yuv420p -s 1280x720 -r 30 -vsync cfr media/fake_video.y4m
ffmpeg -i your_source.mp4 -t 10 -ar 44100 -ac 1 media/fake_audio.wav

If you don't have a source video handy, generate a test pattern:

```bash
ffmpeg -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" \
       -pix_fmt yuv420p -vsync cfr media/fake_video.y4m
ffmpeg -f lavfi -i "anullsrc=r=44100:cl=mono" -t 5 media/fake_audio.wav
```

# 2. Create a Meet room from your host account, copy the URL into .env
cat > .env <<EOF
MEET_URL=https://meet.google.com/your-meet-code
BOT_NAME=Demo Bot
RECORD_SECONDS=15
EOF

# 3. Build and run
docker compose build
docker compose up

# 4. As host, admit the bot when prompted

# 5. After it exits, the recording is in output/
ls output/
open output/recording-*.webm
```

## Local (non-Docker) usage

```bash
npm install
MEET_URL='https://meet.google.com/your-meet-code' node bot.js
```

Local runs in headful mode by default (set `HEADLESS=true` to suppress the window).

## Project layout

```
.
├── bot.js                  Puppeteer entry point + in-page recorder logic
├── Dockerfile              Puppeteer base image + Xvfb
├── docker-compose.yml      Mounts media/ and output/, sets env vars
├── package.json
├── media/                  fake_video.y4m + fake_audio.wav (gitignored, generated locally)
├── output/                 recordings + debug screenshots (gitignored)
├── README.md               This file
└── DESIGN.md               Architecture and trade-off notes
```

## Notes

- **Y4M is uncompressed** — a 10-second 720p clip is ~1.3 GB. Use shorter clips during development.
- **Host must keep their tab open and admit the bot** — guest joins require host approval.
- **The bot exits after `RECORD_SECONDS`** — adjust via `.env`.

## License

MIT