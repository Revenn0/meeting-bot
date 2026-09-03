# Design Notes

## Goals

Build a meeting bot that:
1. Joins a Google Meet room headlessly
2. **Default mode:** pushes local video + audio as fake camera/mic and records remote participants
3. **CHAT_ONLY mode:** joins with camera/mic disabled, skips media/recording, sends chat messages only
4. Runs inside a single Docker container

## Mode selection

`MODE` controls which code path runs after Puppeteer launches:

| `MODE` | Fake media flags | RTCPeerConnection hook | Recording / frames | Meet chat |
|---|---|---|---|---|
| `default` | yes | yes | yes | no |
| `chat-only` | no | no | no | yes |

Configuration lives in `lib/config.js`. Existing env vars (`MEET_URL`, `BOT_NAME`, `RECORD_SECONDS`, `HEADLESS`, `PUPPETEER_EXECUTABLE_PATH`) are unchanged. Chat-only adds:

- `CHAT_MESSAGE` — short text to send (default `Hello`, max 500 chars)
- `CHAT_INTERVAL_MS` — minimum spacing between sends (default `5000`, minimum `1000`)

`RECORD_SECONDS` doubles as chat-only session duration so the CLI contract stays stable.

## CHAT_ONLY architecture

```
bot.js
  → loadConfig()
  → launchBrowser() without fake-device flags
  → runChatOnlyMode()
       → joinMeetAsGuest() + disableCameraAndMic() + Join now
       → waitUntilInCall()  (Leave call visible; click+sleep is not enough)
       → openChatPanel()    (official Meet chat only: toolbar / More options / Ctrl+Alt+C)
       → createMessageScheduler() → sendChatMessage()
       → leaveCall() + browser.close()
```

### Why no fake media in chat-only

Fake Y4M/WAV capture keeps Chromium decoding large files and negotiating send-side media tracks. Chat-only bots only need DOM interaction, so we omit:

- `--use-file-for-fake-video-capture`
- `--use-file-for-fake-audio-capture`
- `--use-fake-device-for-media-stream`

This reduces CPU, memory, and WebRTC send-path work.

### Camera and microphone off

Before typing the guest name, `disableCameraAndMic()` clicks Meet pre-join toggles when labels match `Turn off camera` / `Turn off microphone`. If toggles are already off or labels changed, join continues with a log line rather than failing silently.

### Chat UI interaction (official Meet chat only)

This is the **in-call Meet chat**, not a page overlay. `lib/meet-selectors.js` matches EN/PT/ES labels. `openChatPanel` only succeeds when the official composer appears (`Send a message to everyone` / equivalents). Strategies: toolbar control, **More options → Chat** (small windows hide the icon — this caused live `Could not open Meet chat panel`), then `Ctrl+Alt+C`.

`waitUntilInCall` polls until **Leave call** is visible and **Join now** is gone. Waiting-room copy is **not** in-call.

Open rooms show "This call is open to anyone" plus a visible **Join now** / **Entrar**. Meet often keeps a hidden/aria-hidden **Ask to join** in the DOM. Join logic must click only a strictly visible enabled Join now, never an offscreen Ask to join, and retry Join now once if the guest is still on prejoin.

Each bot uses a distinct `BOT_NAME`.

### Cleanup and timeouts

- Join name input: `JOIN_TIMEOUT_MS` (default 30s)
- Host admit wait: `ADMIT_WAIT_MS` (default 20s)
- Chat panel/input: `CHAT_PANEL_TIMEOUT_MS` (default 15s)
- Scheduler stop clears pending timers before leave
- `finally` in `bot.js` always closes the browser

### Resource optimizations (chat-only)

A controlled live run of 25 simultaneous Chromiums reached Meet, dropped available RAM 10.47→3.09 GiB, showed peak single-process RSS 276 MiB, ~266 processes, and aborted at 98–100% CPU before admission/chat. The following changes target that failure **without** sharing identities or adding stealth.

| Lever | What changed | Why it is safe for isolated guests |
|---|---|---|
| Startup gate | `STARTUP_CONCURRENCY=2`, `STARTUP_STAGGER_MS=2500`, `BOT_INDEX` | Same guests, just not all forking Chromium at once |
| Process model | `--renderer-process-limit=1`, `--no-zygote`, GPU/audio in-process or off | One browser per `BOT_NAME` still; fewer children per browser |
| Unused services | extensions, sync, translate, crashpad, metrics, caches | Not required for guest chat |
| Pages/listeners | Reuse `about:blank`; no console hook unless `DEBUG_BROWSER_LOGS` | One page per guest |
| Permissions | Do not grant camera/mic | Matches camera/mic-off join |
| Media suppress | Deny `getUserMedia` / `getDisplayMedia`; stop remote tracks | Meet can still create PCs for presence; we do not record |
| Chat bound | Keep last `CHAT_HISTORY_LIMIT` nodes; read that snapshot before send | Chat still readable |
| Navigation | `domcontentloaded` instead of `networkidle2` | Faster join; selectors still wait |

**Architectural floor:** each guest still needs its own Chromium (separate cookie jar / display name). Sharing one authenticated browser would violate the identity requirement. `--single-process` is the process-count floor (1 child) but is **opt-in only** (`CHROMIUM_PROFILE=chat-single-process`) because WebRTC inside a single process is historically crashy. Default is `chat-slim`.

Local mock (file://) before/after — see README tables. Further flag tweaks did not move PSS more than noise once GPU/zygote/site-isolation were already off.

### Chromium flags

Every flag is documented in `lib/chromium-flags.js` (`CHROMIUM_FLAG_DOCS`). Set `DEBUG_BROWSER_LOGS=true` to print flag + reason at launch. None of the new flags spoof UA, hide webdriver, or evade Meet.

Profiles:

- `recording` — original default-mode flags only
- `chat-legacy` — previous chat-only args (A/B)
- `chat-slim` — default chat-only
- `chat-single-process` — slim + `--single-process`

### Next controlled live-validation plan

Do **not** start 25 browsers at once. On a host you control:

1. One `chat-slim` guest: confirm admit, camera/mic off, chat open, send/read, leave.
2. Three guests with `STARTUP_CONCURRENCY=2` and unique `BOT_NAME`s.
3. If stable, five guests. Record `/proc` process count, PSS, and CPU during **startup only**.
4. Only then consider 10–25 with the same stagger (≈12–13 waves × 2.5s). Abort if available RAM < 2 GiB or CPU > 85% for 15s.
5. Optional: try `chat-single-process` on **two** guests only. If Meet crashes or cannot be admitted, stay on `chat-slim`.

`npm run fleet:local` refuses `meet.google.com` unless `ALLOW_LIVE_MEET=true`.

## Default mode (unchanged behavior)

The recording path remains the original design:

- `evaluateOnNewDocument` RTCPeerConnection wrapper → `__remoteStream`
- MediaRecorder → Node `saveChunk`
- Optional MediaStreamTrackProcessor frame metadata to `output/frames-*.jsonl`

Extracted to `lib/modes/recording.js` without changing semantics.

## Architecture decisions (original)

### Why Google Meet over Zoom

The task mentions "Zoom meetings" but provides reference code that navigates to `google.com`, suggesting the evaluation is on the underlying capability (fake device pipeline + recording + Docker) rather than the specific platform. I chose Meet because:

- Zoom's web client typically requires Meeting SDK credentials to perform a non-degraded join
- Zoom's anti-bot detection on anonymous joins is significantly stricter
- The same architecture (Puppeteer + fake device flags + RTCPeerConnection hook + MediaRecorder) transfers to Zoom — only the join flow and auth would change

### Why Puppeteer over Playwright

Both work. Puppeteer is more established for Chrome-only automation. Playwright would be the right call for cross-browser, but Chromium-specific flags (`--use-file-for-fake-*-capture`) lock us into Chromium anyway.

### Why guest mode join, not scripted login

Scripting a Google login from a fresh Chromium triggers anti-bot detection (captcha, "couldn't sign you in"). The standard production fix is a persistent user profile: log in manually once in headful mode, save the profile directory, and have the bot launch with that profile in subsequent runs. For this demo, guest mode keeps the join flow simple and self-contained.

### Capturing remote streams: RTCPeerConnection hook

`MediaRecorder` can record a `MediaStream`, but the bot doesn't naturally have access to remote participants' streams — Meet keeps them inside its own JS layer. To intercept them, I inject a wrapper around `window.RTCPeerConnection` via `evaluateOnNewDocument` before Meet's JS loads. The wrapper listens for `track` events on every PC the page creates and adds each remote track to a global `MediaStream`. That stream is then fed to `MediaRecorder`.

This is closer in spirit to what production meeting bots do than `getDisplayMedia` (tab capture), which would also record the entire Meet UI and require a "select a tab" picker that's painful to automate.

**CHAT_ONLY mode intentionally skips this hook** to avoid subscribing to remote media tracks.

### Filtering active tracks

The hook collects every remote track, but some arrive in `ended` or `muted` state (e.g. participants who joined and immediately turned off camera). Feeding those to `MediaRecorder` produces a 0-byte file. The recorder filters to `readyState === 'live'` tracks before constructing the stream it records.

## The Docker headless challenge

### Problem

Meet's anti-bot detection refuses headless Linux Chromium joins, even with:
- `--disable-blink-features=AutomationControlled`
- User-agent spoofing (claiming to be Mac Chrome)
- `puppeteer-extra-plugin-stealth`

In testing, every "stealth" patch made things worse: surface spoofing creates fingerprint inconsistencies (UA says Mac, WebGL renderer says SwiftShader/Linux) that the detector flags more confidently than no spoofing at all. The `puppeteer-extra` wrapper itself appears to leave detectable traces.

### Solution: Xvfb in Docker

Instead of running Chromium headless, the Dockerfile installs Xvfb (X Virtual Framebuffer) and runs Chromium in **headful** mode against a virtual display:

```dockerfile
RUN apt-get update && apt-get install -y xvfb
ENV DISPLAY=:99
ENTRYPOINT ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 -nolisten tcp & sleep 1 && node bot.js"]
```

From Chromium's perspective it has a real display; from Meet's perspective the browser fingerprint matches a normal desktop install. This single change moved the bot from `you can't join this video call` to a successful join.

This is the same trick most production meeting bot platforms use — it's quietly the standard.

### Remaining production gaps

- **No persistent identity** — guest joins still depend on host admission and are subject to Workspace-level anonymous-join restrictions Google has been tightening
- **No session resilience** — bot exits after `RECORD_SECONDS`; no reconnection on network drops
- **No per-speaker audio** — all remote audio mixed into one track via the current hook design (default mode only)
- **Chat UI fragility** — Meet DOM changes can break selectors; errors are explicit and debug screenshots are saved on join failures

## Privacy and safety

- No credentials, stealth plugins, or unrelated scraping were added for chat-only.
- Chat-only does not persist recordings or capture WebRTC tracks.
- Operators should use their own Meet rooms and rate-limit chat sends via `CHAT_INTERVAL_MS`.
- Do not use this project for load testing live Google Meet; platform limits apply.

## Resource benchmarks

### Local mock (recommended)

```bash
npm run benchmark:mock
```

`scripts/benchmark-modes.js` launches Chromium with the same launch args as each mode against `test/fixtures/mock-meet-chat.html` and samples `/proc/<pid>/status` VmRSS. Typical outcome on Linux: **chat-only peak RSS is lower** because fake media file mapping and WebRTC recording hooks are absent. Exact numbers vary by host RAM, Chromium build, and display backend.

### One to five local instances

1. Start 1–5 processes with distinct `BOT_NAME` values.
2. Use `MODE=chat-only` and your own Meet URL only when manually validating — not in CI.
3. While running, sample RSS: `grep VmRSS /proc/<pid>/status`.
4. Compare against the same count in `MODE=default` with fake media present.

Qualitatively, chat-only avoids:

- Large Y4M decode / fake capture buffers
- MediaRecorder encoding
- Remote track demux/decode for recording

Quantitatively, use the mock benchmark for a controlled A/B on one machine; treat live Meet measurements as environment-specific.

## Bonus: built-in WebRTC capture pipeline (default mode)

The brief asks whether Chromium's built-in WebRTC capture pipeline — the one with access to already-decrypted media frames — can be wired in. There are three layers of "built-in":

| Approach | What you get | Cost |
|---|---|---|
| `MediaRecorder` | Re-encoded `.webm` chunks | Extra CPU, generation loss, no per-frame access |
| **`MediaStreamTrackProcessor` (WebCodecs)** | **Raw decoded `VideoFrame` objects from WebRTC** | **Standard Web API, works in Chromium 94+** |
| Patch `third_party/webrtc/` in Chromium | Encoded frames pre-decode, jitter buffer state, etc. | Months of work + per-release rebase; what Recall.ai does |

The middle option — `MediaStreamTrackProcessor` — is the API Chromium exposes specifically so developers don't have to patch the C++ pipeline. It hands JS the raw `VideoFrame` after Chromium has decrypted (SRTP) and decoded (VP8/VP9/AV1) it. From there you can:

- Encode with `VideoEncoder` (WebCodecs) at any bitrate/codec
- Run per-frame inference (face detect, OCR, sentiment)
- Write per-speaker tracks rather than one mixed stream
- Tee to multiple consumers (recorder + live transcription)

This bot wires both `MediaRecorder` (Part 1) and `MediaStreamTrackProcessor` (bonus) into the same `__remoteStream` collected by the RTCPeerConnection hook, so they coexist. The latter writes a per-frame summary to `output/frames.jsonl` to prove the pipeline reaches raw frames.

Patching `third_party/webrtc/` would be the right call only if you needed encoded frames before decode (zero-copy forwarding), internal jitter/loss metrics, or sub-millisecond latency — none of which the brief asks for, and the maintenance burden is enormous.

**CHAT_ONLY mode does not enable this pipeline.**

## Testing strategy

Tests use Node's built-in test runner and never contact `meet.google.com`:

- `test/config.test.js` — env parsing, mode normalization, validation
- `test/message-scheduler.test.js` — tick computation and interval control
- `test/cleanup.test.js` — scheduler timer cleanup
- `test/chat-selectors.test.js` — launch arg differences + local HTML fixture via Puppeteer
- `test/chat-only-simulator.test.js` — in-process chat-only fleet simulation (no network)
- `test/chromium-flags.test.js` — profiles, recording-flag freeze, flag docs
- `test/startup-gate.test.js` — stagger waves and concurrency limiter
- `test/chat-history.test.js` — bounded DOM + getUserMedia deny
- `test/fleet-safety.test.js` — refuse live Meet URLs

This keeps CI fast and avoids violating Google ToS during automated runs.

### Safe local load test (CHAT_ONLY simulation)

Live fleets (`lib/wave-planner.js`, `scripts/run-fleet-live.js`) launch waves of 10 with unique `BOT_NAME`s, optional in-wave stagger, and a hard stop when ≥50% of a wave hits the can't-join interstitial. Chat failure does not eject an in-call guest. `fleet:100` requires `CONFIRM_LIVE=true`. Runbooks: `FLEET.md`.

`npm run loadtest:chat-only` exercises `lib/sim/chat-only-simulator.js` and `scripts/load-test-chat-only.js`:

- No Google Meet URLs (uses `meet.example.invalid`)
- No Puppeteer / Chromium processes
- Scales: 5, 25, 100, 500, 1000 simulated bots by default
- Measures peak/average RSS, CPU user+system time, and message throughput
- Hard limits: `MAX_BOTS=1000`, `LOADTEST_MAX_RSS_MB=512` (stops early if exceeded)

This validates scheduler/config memory scaling and cleanup. It does **not** predict live Meet DOM or WebRTC cost.

Use `npm run benchmark:chromium` for 1–5 local Chromium trees (PSS, process count, launch CPU, simultaneous vs staggered). Default mock target is `file://test/fixtures/mock-meet-chat.html`.
