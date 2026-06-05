// bot.js - Meeting bot that joins Google Meet, pushes fake media,
// and records remote participants' audio/video via RTCPeerConnection hook.

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEET_URL = process.env.MEET_URL || 'https://meet.google.com/YOUR-MEET-CODE';
const BOT_NAME = process.env.BOT_NAME || 'Brian Gu';
const VIDEO_PATH = path.resolve(__dirname, 'media/fake_video.y4m');
const AUDIO_PATH = path.resolve(__dirname, 'media/fake_audio.wav');
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `recording-${Date.now()}.webm`);
const RECORD_SECONDS = parseInt(process.env.RECORD_SECONDS || '15', 10);
const HEADLESS = process.env.HEADLESS === 'true';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('[bot] Launching...');
  console.log('[bot] Video source:', VIDEO_PATH);
  console.log('[bot] Audio source:', AUDIO_PATH);
  console.log('[bot] Output:', OUTPUT_FILE);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=en-US',
      // Reduce automation fingerprint
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      // Window size for the virtual display (Xvfb in Docker, real in local)
      '--window-size=1280,720',
      // Fake media: replace camera/mic with local files
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${VIDEO_PATH}`,
      `--use-file-for-fake-audio-capture=${AUDIO_PATH}`,
      '--allow-file-access-from-files',
    ],
  });

  // Bind Node-side functions so the in-page recorder can stream chunks to disk
  const writeStream = fs.createWriteStream(OUTPUT_FILE);

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone']);

    const page = await browser.newPage();

    // Inject RTCPeerConnection hook BEFORE Meet's JS runs.
    // This wraps every PC created by Meet so we can collect all remote tracks
    // into a single MediaStream that we can later feed to MediaRecorder.
    await page.evaluateOnNewDocument(() => {
      console.log('[hook] Installing RTCPeerConnection wrapper');
      window.__remoteStream = new MediaStream();

      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function (...args) {
        const pc = new OriginalRTCPeerConnection(...args);
        pc.addEventListener('track', (event) => {
          console.log('[hook] Remote track:', event.track.kind, event.track.id);
          window.__remoteStream.addTrack(event.track);
        });
        return pc;
      };
      window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
      console.log('[hook] Installed');
    });

    await page.exposeFunction('saveChunk', (chunkArray) => {
      writeStream.write(Buffer.from(chunkArray));
    });
    await page.exposeFunction('finishRecording', () => {
      writeStream.end();
      console.log('[bot] Recording flushed to disk:', OUTPUT_FILE);
    });

    page.on('console', msg => {
      if (msg.type() === 'log') {
        console.log('[browser]', msg.text());
      }
    });
    console.log(`[bot] Navigating to ${MEET_URL}`);
    await page.goto(MEET_URL, { waitUntil: 'networkidle2' });

    // Guest-mode join: type name + click "Ask to join"
    try {
      await page.waitForSelector('input[type="text"]', { timeout: 30000 });
    } catch (err) {
      const ts = Date.now();
      const screenshotPath = path.join(OUTPUT_DIR, `debug-${ts}.png`);
      console.log('[bot] Name input not found, taking screenshot...');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log('[bot] Screenshot saved to', screenshotPath);
      const html = await page.content();
      console.log('[bot] Page HTML preview:', html.substring(0, 2000));
      throw err;
    }
    await page.type('input[type="text"]', BOT_NAME);
    await new Promise((r) => setTimeout(r, 1000));

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const askButton = buttons.find((b) => {
        const text = (b.textContent || '').toLowerCase();
        return text.includes('ask to join') || text.includes('join now');
      });
      askButton?.click();
    });
    console.log('[bot] Requested to join');

    console.log('[bot] Waiting 20s for host admit and remote tracks to arrive...');
    await new Promise((r) => setTimeout(r, 20000));

    const trackCount = await page.evaluate(() => {
      return window.__remoteStream?.getTracks().length || 0;
    });
    console.log(`[bot] Remote stream has ${trackCount} track(s)`);

    if (trackCount === 0) {
      console.log('[bot] WARN: no remote tracks. Bot may not be admitted, or host has camera/mic off.');
    }

    console.log(`[bot] Recording for ${RECORD_SECONDS}s...`);
    await page.evaluate((seconds) => {
      return new Promise((resolve, reject) => {
        const stream = window.__remoteStream;

        // Debug: log every track's state before recording
        const tracks = stream.getTracks();
        console.log(`[recorder] Stream has ${tracks.length} tracks:`);
        tracks.forEach((t, i) => {
          console.log(`  Track ${i}: kind=${t.kind}, readyState=${t.readyState}, enabled=${t.enabled}, muted=${t.muted}`);
        });

        // Keep only live tracks - ended/inactive tracks cause MediaRecorder to produce 0-byte output
        const activeTracks = tracks.filter(t => t.readyState === 'live');
        console.log(`[recorder] Active tracks: ${activeTracks.length}`);

        if (activeTracks.length === 0) {
          console.log('[recorder] No active tracks, aborting');
          resolve();
          return;
        }

        // Build a fresh stream containing only the live tracks
        const recordStream = new MediaStream(activeTracks);

        const recorder = new MediaRecorder(recordStream, {
          mimeType: 'video/webm;codecs=vp8,opus',
        });

        let chunkCount = 0;
        recorder.ondataavailable = async (e) => {
          console.log(`[recorder] dataavailable: size=${e.data.size}`);
          if (e.data.size > 0) {
            chunkCount++;
            const buffer = await e.data.arrayBuffer();
            const arr = Array.from(new Uint8Array(buffer));
            await window.saveChunk(arr);
          }
        };

        recorder.onstop = async () => {
          console.log(`[recorder] stopped, total chunks: ${chunkCount}`);
          await window.finishRecording();
          resolve();
        };

        recorder.onerror = (e) => {
          console.log('[recorder] ERROR:', e.error?.message);
          reject(e);
        };

        recorder.start(1000);
        console.log('[recorder] Started, state:', recorder.state);

        setTimeout(() => {
          console.log('[recorder] Stopping, state:', recorder.state);
          recorder.stop();
        }, seconds * 1000);
      });
    }, RECORD_SECONDS);


    // Give the writeStream a moment to flush
    // This taps Chromium's built-in WebRTC capture pipeline directly,
    // getting raw VideoFrame objects after SRTP decrypt + VP8/VP9 decode,
    // without going through MediaRecorder's re-encode step.
    console.log('[bot] BONUS: capturing raw VideoFrames via MediaStreamTrackProcessor...');

    const frameMetadata = await page.evaluate(async (seconds) => {
      const videoTracks = window.__remoteStream
        .getVideoTracks()
        .filter((t) => t.readyState === 'live');

      if (videoTracks.length === 0) {
        console.log('[trackproc] No live video tracks; skipping.');
        return [];
      }

      const track = videoTracks[0];
      console.log('[trackproc] Tapping video track:', track.id);

      // MediaStreamTrackProcessor: standard WebCodecs API.
      // .readable is a ReadableStream of VideoFrame objects.
      const processor = new MediaStreamTrackProcessor({ track });
      const reader = processor.readable.getReader();

      const meta = [];
      const deadline = Date.now() + seconds * 1000;
      let count = 0;

      while (Date.now() < deadline) {
        const { value: frame, done } = await reader.read();
        if (done) break;

        // Each VideoFrame carries raw decoded pixel data + timing metadata.
        meta.push({
          i: count,
          ts: frame.timestamp,
          codedWidth: frame.codedWidth,
          codedHeight: frame.codedHeight,
          format: frame.format,
          duration: frame.duration,
        });
        count++;

        // Must close to release the underlying GPU/CPU buffer.
        frame.close();
      }

      reader.cancel();
      console.log('[trackproc] Captured', count, 'raw frames');
      return meta;
    }, 5);  // 5 seconds of raw frame capture

    // Write per-frame metadata as JSONL (one frame per line)
    const framesPath = path.join(OUTPUT_DIR, `frames-${Date.now()}.jsonl`);
    fs.writeFileSync(
      framesPath,
      frameMetadata.map((f) => JSON.stringify(f)).join('\n') + '\n'
    );
    console.log('[bot] BONUS: wrote', frameMetadata.length, 'frame records to', framesPath);
    await new Promise((r) => setTimeout(r, 2000));

    console.log('[bot] Done. Output:', OUTPUT_FILE);
  } catch (err) {
    console.error('[bot] Fatal error:', err.message);
    throw err;
  } finally {
    // Always clean up — even if something above threw
    if (!writeStream.closed) writeStream.end();
    await browser.close().catch((e) => console.error('[bot] browser close failed:', e.message));
    console.log('[bot] Cleanup done.');
  }
})();