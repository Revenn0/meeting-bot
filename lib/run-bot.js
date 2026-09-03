import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, isChatOnlyMode, MODES } from './config.js';
import { launchBrowser } from './browser.js';
import { applyMeetPermissions, acquirePage } from './page-setup.js';
import { applyStartupGate } from './startup-gate.js';
import { runRecordingMode } from './modes/recording.js';
import { runChatOnlyMode } from './modes/chat-only.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function resolvePaths(config) {
  const outputDir = path.resolve(ROOT, config.paths.outputDir || 'output');
  const videoPath = path.resolve(ROOT, config.paths.video || 'media/fake_video.y4m');
  const audioPath = path.resolve(ROOT, config.paths.audio || 'media/fake_audio.wav');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return { outputDir, videoPath, audioPath };
}

export async function runBot(env = process.env) {
  const config = loadConfig(env);
  const { outputDir, videoPath, audioPath } = resolvePaths(config);
  const runtimeConfig = { ...config, outputDir };

  console.log('[bot] Launching in mode:', config.mode);
  console.log('[bot] Meet URL:', config.meetUrl);
  console.log('[bot] Bot name:', config.botName);

  if (isChatOnlyMode(config)) {
    console.log('[bot] CHAT_ONLY: official Meet chat, camera/mic off, one guest identity.');
    await applyStartupGate(runtimeConfig);
  } else {
    console.log('[bot] Video source:', videoPath);
    console.log('[bot] Audio source:', audioPath);
  }

  const browser = await launchBrowser(runtimeConfig, { videoPath, audioPath });
  let writeStream = null;
  let outputFile = null;

  try {
    await applyMeetPermissions(browser, runtimeConfig);
    const page = await acquirePage(browser, runtimeConfig);

    if (config.mode === MODES.DEFAULT) {
      outputFile = path.join(outputDir, `recording-${Date.now()}.webm`);
      writeStream = fs.createWriteStream(outputFile);
      console.log('[bot] Output:', outputFile);
      await runRecordingMode({
        browser,
        page,
        config: runtimeConfig,
        outputFile,
        writeStream,
      });
    } else {
      await runChatOnlyMode({ page, config: runtimeConfig });
    }
  } catch (err) {
    console.error('[bot] Fatal error:', err.message);
    throw err;
  } finally {
    if (writeStream && !writeStream.closed) {
      writeStream.end();
    }
    await browser.close().catch((error) => {
      console.error('[bot] browser close failed:', error.message);
    });
    console.log('[bot] Cleanup done.');
  }
}
