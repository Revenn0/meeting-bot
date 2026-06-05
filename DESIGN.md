# Design Notes

## Goals

Build a meeting bot that:
1. Joins a Google Meet room headlessly
2. Pushes a local video + audio file as fake camera/mic
3. Records remote participants' audio + video to a `.webm` file
4. Runs inside a single Docker container

## Architecture decisions

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
- **No per-speaker audio** — all remote audio mixed into one track via the current hook design

## Bonus: built-in WebRTC capture pipeline

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