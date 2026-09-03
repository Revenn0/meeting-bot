# Meeting Bot

A headless browser bot that joins Google Meet. The default mode pushes local video/audio as fake camera/mic and records remote participants to disk. **CHAT_ONLY mode** joins with camera and microphone disabled, skips media injection and WebRTC capture, and interacts only through the Meet chat UI.

Runs inside a single Docker container.

## Features

- **Headless join** — bot joins Meet automatically as a guest
- **Default (recording) mode** — pushes local `.y4m` video and `.wav` audio as fake camera/mic; records remote participants' audio + video to `.webm`
- **CHAT_ONLY mode** — camera/mic off, no fake media, no WebRTC hook/recording; sends configured chat messages at a controlled rate
- **Native Chromium pipeline (default mode)** — uses Chromium fake-device flags and an `RTCPeerConnection` hook
- **Single Docker container** — `docker compose up` and the bot joins

## Architecture

```
Node.js (bot.js)
  ↓ config (MODE, MEET_URL, BOT_NAME, ...)
  ↓ Puppeteer
Chromium (headful via Xvfb in Docker)
  ↓ navigates to meet.google.com/<code>

Default mode:
  ↓ inject RTCPeerConnection wrapper
  ↓ fake_video.y4m + fake_audio.wav as camera/mic
  ↓ MediaRecorder + optional MediaStreamTrackProcessor

CHAT_ONLY mode:
  ↓ disable camera/mic on pre-join screen
  ↓ open Meet chat panel
  ↓ send CHAT_MESSAGE every CHAT_INTERVAL_MS
  ↓ leave call + browser cleanup
```

See `DESIGN.md` for design rationale, privacy notes, and benchmark instructions.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MEET_URL` | `https://meet.google.com/YOUR-MEET-CODE` | Meet room URL |
| `BOT_NAME` | `Brian Gu` | Guest display name (use a unique name per bot instance) |
| `RECORD_SECONDS` | `15` | Session duration (recording length or chat-only runtime) |
| `HEADLESS` | `false` | Set `true` for headless Chromium |
| `PUPPETEER_EXECUTABLE_PATH` | *(bundled)* | Custom Chromium binary path |
| `MODE` | `default` | `default` (recording) or `chat-only` |
| `CHAT_MESSAGE` | `Hello` | Short message sent in chat-only mode (max 500 chars) |
| `CHAT_INTERVAL_MS` | `5000` | Minimum interval between chat messages (≥ 1000 ms) |
| `JOIN_TIMEOUT_MS` | `30000` | Pre-join name input timeout |
| `ADMIT_WAIT_MS` | `20000` | Wait for host admit before recording/chat |
| `CHAT_PANEL_TIMEOUT_MS` | `15000` | Timeout opening chat input |

## Quick start (default recording mode)

```bash
# 1. Prepare fake media files from your source video
mkdir -p media output
ffmpeg -i your_source.mp4 -t 10 -pix_fmt yuv420p -s 1280x720 -r 30 -vsync cfr media/fake_video.y4m
ffmpeg -i your_source.mp4 -t 10 -ar 44100 -ac 1 media/fake_audio.wav

# Or generate a test pattern:
ffmpeg -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" \
       -pix_fmt yuv420p -vsync cfr media/fake_video.y4m
ffmpeg -f lavfi -i "anullsrc=r=44100:cl=mono" -t 5 media/fake_audio.wav

# 2. Create a Meet room from your host account, copy the URL into .env
cat > .env <<EOF
MEET_URL=https://meet.google.com/your-meet-code
BOT_NAME=Demo Bot
RECORD_SECONDS=15
MODE=default
EOF

# 3. Build and run
docker compose build
docker compose up

# 4. As host, admit the bot when prompted

# 5. After it exits, the recording is in output/
ls output/
```

## CHAT_ONLY mode

Use your **own** Google Meet room. Give each bot a **unique** `BOT_NAME`. Do not run load tests or stress tests against live Meet — Google enforces platform limits and Workspace policies.

```bash
cat > .env <<EOF
MEET_URL=https://meet.google.com/your-meet-code
BOT_NAME=Chat Bot Alpha
RECORD_SECONDS=60
MODE=chat-only
CHAT_MESSAGE=Hello from the bot
CHAT_INTERVAL_MS=5000
EOF

docker compose up
```

Local (non-Docker):

```bash
npm install
MODE=chat-only \
MEET_URL='https://meet.google.com/your-meet-code' \
BOT_NAME='Chat Bot Beta' \
CHAT_MESSAGE='Checking in' \
CHAT_INTERVAL_MS=8000 \
RECORD_SECONDS=45 \
node bot.js
```

CHAT_ONLY mode:

- Does **not** require `media/fake_video.y4m` or `media/fake_audio.wav`
- Keeps camera and microphone off in the pre-join flow
- Skips fake media Chromium flags, RTCPeerConnection hooks, MediaRecorder, and frame capture
- Opens chat, sends messages at `CHAT_INTERVAL_MS`, then leaves the call and closes the browser

If Meet changes its UI, the bot saves a debug screenshot under `output/` and exits with a clear selector error.

## Tests (no live Meet)

```bash
npm install
npm test
```

Tests cover configuration parsing, mode selection, message scheduling, cleanup, browser arg differences, and a local HTML mock page for chat selectors.

## Resource benchmark (local mock)

Compare peak RSS between modes on a local mock page (does not contact Google Meet):

```bash
npm run benchmark:mock
```

For one to five instances locally, run separate terminals with distinct `BOT_NAME` values and compare `ps`/`/proc/<pid>/status` RSS while sessions are active. Expect CHAT_ONLY to use less memory and CPU because it avoids fake media files, WebRTC decode, and recording.

**Real Meet scale** (many concurrent bots in one room) is subject to Google account limits, admission controls, and anti-abuse policies. This project does not include stress-testing tooling for live Meet.

## Privacy and safety

- Use only Meet rooms you control or are authorized to join.
- Do not add credentials, stealth/evasion, or unrelated data scraping.
- Keep `CHAT_MESSAGE` short and non-sensitive; messages are visible to all participants.
- CHAT_ONLY mode does not record audio, video, or chat history to disk.

## Project layout

```
.
├── bot.js                      Entry point
├── lib/
│   ├── config.js               Env parsing and mode selection
│   ├── browser.js              Puppeteer launch args per mode
│   ├── meet-join.js            Guest join + disable camera/mic
│   ├── meet-chat.js            Chat panel open/send/leave
│   ├── chat-selectors.js       Resilient Meet UI selectors
│   ├── message-scheduler.js    Controlled chat send timing
│   └── modes/
│       ├── recording.js        Default media + recording path
│       └── chat-only.js        Chat-only session path
├── test/                       Unit/mock tests (no Meet)
├── scripts/benchmark-modes.js  Local RSS comparison helper
├── Dockerfile
├── docker-compose.yml
├── README.md
└── DESIGN.md
```

## Notes

- **Y4M is uncompressed** — a 10-second 720p clip is ~1.3 GB. Use shorter clips during development (default mode only).
- **Host must keep their tab open and admit the bot** — guest joins require host approval.
- **The bot exits after `RECORD_SECONDS`** in both modes.

## License

MIT
