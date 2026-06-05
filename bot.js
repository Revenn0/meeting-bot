// bot.js - Meeting bot that joins Google Meet, pushes fake media,
// and records remote participants' audio/video via RTCPeerConnection hook.

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// puppeteer.use(StealthPlugin());

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
      // Stealth flags - make headless Chromium look more like a real browser
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      // Window size (no display in Docker, but Chromium needs this)
      '--window-size=1280,720',
      // Fake media
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${VIDEO_PATH}`,
      `--use-file-for-fake-audio-capture=${AUDIO_PATH}`,
      '--allow-file-access-from-files',
    ],
  });

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

  // Bind Node-side functions so the in-page recorder can stream chunks to disk
  const writeStream = fs.createWriteStream(OUTPUT_FILE);
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
      
      // Debug: 检查每个 track 的状态
      const tracks = stream.getTracks();
      console.log(`[recorder] Stream has ${tracks.length} tracks:`);
      tracks.forEach((t, i) => {
        console.log(`  Track ${i}: kind=${t.kind}, readyState=${t.readyState}, enabled=${t.enabled}, muted=${t.muted}`);
      });
      
      // 只保留 live + active 的 tracks
      const activeTracks = tracks.filter(t => t.readyState === 'live');
      console.log(`[recorder] Active tracks: ${activeTracks.length}`);
      
      if (activeTracks.length === 0) {
        console.log('[recorder] No active tracks, aborting');
        resolve();
        return;
      }
      
      // 构建新的 stream，只包含 active tracks
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
  await new Promise((r) => setTimeout(r, 2000));

  await browser.close();
  console.log('[bot] Done. Output:', OUTPUT_FILE);
})();