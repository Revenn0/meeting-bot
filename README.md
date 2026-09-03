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
  ↓ optional startup stagger (BOT_INDEX / STARTUP_CONCURRENCY)
  ↓ slim Chromium (chat-slim profile)
  ↓ reuse about:blank page; deny camera/mic permissions
  ↓ suppress getUserMedia + stop remote tracks (no recording)
  ↓ disable camera/mic on pre-join screen
  ↓ open Meet chat, read/send with bounded history
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
| `CHROMIUM_PROFILE` | `chat-slim` in chat-only | `chat-slim` (default), `chat-legacy` (A/B), `chat-single-process` (experimental) |
| `WINDOW_SIZE` | `800x600` chat-only / `1280x720` default | Chromium window / viewport |
| `CHAT_HISTORY_LIMIT` | `20` | Max chat DOM nodes kept after each send |
| `BOT_INDEX` | `0` | Fleet index used to compute startup delay |
| `STARTUP_CONCURRENCY` | `2` | How many bots may launch in the same wave |
| `STARTUP_STAGGER_MS` | `2500` | Delay between startup waves |
| `STARTUP_JITTER_MS` | `250` | Extra random delay per bot |
| `JS_HEAP_MB` | `96` | V8 `--max-old-space-size` in chat-slim |
| `DEBUG_BROWSER_LOGS` | unset | Set `true` to print Chromium flags and page console |

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
CHROMIUM_PROFILE=chat-slim
STARTUP_CONCURRENCY=2
STARTUP_STAGGER_MS=2500
CHAT_HISTORY_LIMIT=20
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
- Keeps camera and microphone off in the pre-join flow and does not grant those permissions
- Skips fake media Chromium flags, recording hooks, MediaRecorder, and frame capture
- Reuses the initial page, suppresses local media capture, and stops remote tracks without recording them
- Opens chat, reads a bounded snapshot, sends `CHAT_MESSAGE` at `CHAT_INTERVAL_MS`, then leaves
- Each process is still a **separate guest identity** (`BOT_NAME`). Do not share one logged-in profile.

For 2–5 local guests against a **mock page** (not Meet):

```bash
FLEET_SIZE=3 npm run fleet:local
```

`scripts/run-fleet.js` refuses `meet.google.com` unless `ALLOW_LIVE_MEET=true`.

If Meet changes its UI, the bot saves a debug screenshot under `output/` and exits with a clear selector error.

## Tests (no live Meet)

```bash
npm install
npm test
```

Tests cover configuration parsing, mode selection, message scheduling, cleanup, browser arg differences, a local HTML mock page for chat selectors, and an in-process chat-only simulator.

### Safe local load test (no Meet, no browser)

Simulates CHAT_ONLY scheduler sessions in-process at scales 5/25/100/500/1000 bots (configurable). Uses a non-routable Meet URL and never opens Puppeteer or the network:

```bash
npm run loadtest:chat-only
# optional: npm run loadtest:chat-only -- --counts=5,25,100
```

Limits: `MAX_BOTS=1000` (hard cap), `LOADTEST_MAX_RSS_MB=512` (stops if peak RSS exceeds this). Override session timing with `LOADTEST_RECORD_SECONDS` and `LOADTEST_CHAT_INTERVAL_MS` (minimum 1000 ms).

## Resource benchmark (local mock)

```bash
npm run benchmark:mock          # Node RSS: default vs chat-only launch args
npm run benchmark:chromium      # 1–5 Chromium trees, PSS/process/CPU (file:// mock)
```

Local Chromium comparison on this host (file:// mock, **no Google Meet**):

| Profile | Procs/bot | PSS/bot (1 inst) | Peak single RSS | Launch | CPU (1 inst) |
|---|---|---|---|---|---|
| `chat-legacy` (previous chat-only) | 8 | 296 MB | 188 MB | 273 ms | 62 ms |
| **`chat-slim` (default)** | **4** | **273 MB** | 192 MB | **200 ms** | **28 ms** |
| `chat-single-process` (experimental) | 1 | 216 MB | 231 MB | 228 ms | 28 ms |

5× `chat-slim` (concurrency 2, staggered): 20 processes, ~167 MB PSS/bot, max launch 266 ms, CPU 244 ms.  
5× simultaneous: same process count, launch **506 ms**, CPU **574 ms** — stagger is what avoids the 98–100% CPU abort seen with 25 live Chromiums.

**25-bot estimate** from the 5-instance slim mock (PSS, linear): ~**100 processes**, ~**4.1 GiB** unique. Live Meet UI/decode will add more; previous uncontrolled live run used ~7.4 GiB and 266 processes. `chat-single-process` is **not** the live default — WebRTC in one process is unstable.

**Real Meet scale** is subject to Google limits. Do not stress-test live Meet from CI.

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
│   ├── chromium-flags.js       Documented Chromium profiles
│   ├── startup-gate.js         Stagger / concurrency
│   ├── media-suppress.js       Deny capture, stop remote tracks
│   ├── chat-history.js         Bounded chat DOM
│   └── modes/
│       ├── recording.js        Default media + recording path
│       └── chat-only.js        Chat-only session path
├── test/                       Unit/mock tests (no Meet)
├── scripts/benchmark-chromium-profiles.js
├── scripts/run-fleet.js        1–5 isolated local guests (blocks live Meet)
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
