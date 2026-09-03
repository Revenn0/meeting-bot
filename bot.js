import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, isChatOnlyMode, MODES } from './lib/config.js';
import { launchBrowser } from './lib/browser.js';
import { runRecordingMode } from './lib/modes/recording.js';
import { runChatOnlyMode } from './lib/modes/chat-only.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePaths(config) {
  const outputDir = path.resolve(__dirname, config.paths.outputDir || 'output');
  const videoPath = path.resolve(__dirname, config.paths.video || 'media/fake_video.y4m');
  const audioPath = path.resolve(__dirname, config.paths.audio || 'media/fake_audio.wav');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return { outputDir, videoPath, audioPath };
}

async function main() {
  const config = loadConfig(process.env);
  const { outputDir, videoPath, audioPath } = resolvePaths(config);
  const runtimeConfig = { ...config, outputDir };

  console.log('[bot] Launching in mode:', config.mode);
  console.log('[bot] Meet URL:', config.meetUrl);
  console.log('[bot] Bot name:', config.botName);

  if (isChatOnlyMode(config)) {
    console.log('[bot] CHAT_ONLY mode: no fake media files or recording output expected.');
  } else {
    console.log('[bot] Video source:', videoPath);
    console.log('[bot] Audio source:', audioPath);
  }

  const browser = await launchBrowser(runtimeConfig, { videoPath, audioPath });
  let writeStream = null;
  let outputFile = null;

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone']);

    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        console.log('[browser]', msg.text());
      }
    });

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

main().catch((err) => {
  console.error('[bot] Exiting with error:', err.message);
  process.exitCode = 1;
});
