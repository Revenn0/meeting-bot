import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../lib/load-env.js';
import { runBot } from '../lib/run-bot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    throw new Error(`Node.js 20+ is required (found ${process.version}). Install LTS from https://nodejs.org`);
  }
}

function prepareOneBotEnv() {
  const loaded = loadLocalEnv(root);
  if (loaded.loaded) {
    console.log('[bot:one] Loaded', loaded.path);
  } else {
    console.log('[bot:one] No .env found. Copy .env.example to .env first.');
  }

  process.env.MODE = process.env.MODE || 'chat-only';
  process.env.HEADLESS = process.env.HEADLESS || 'false';
  process.env.WINDOW_SIZE = process.env.WINDOW_SIZE || '1280x720';
  process.env.STARTUP_STAGGER_MS = process.env.STARTUP_STAGGER_MS || '0';
  process.env.STARTUP_JITTER_MS = process.env.STARTUP_JITTER_MS || '0';

  const meetUrl = process.env.MEET_URL || '';
  if (!/meet\.google\.com\//i.test(meetUrl) || /YOUR-MEET-CODE/i.test(meetUrl)) {
    throw new Error(
      'Set MEET_URL in .env to an open Google Meet link (https://meet.google.com/xxx-yyyy-zzz). '
        + 'Create the room first, keep the host tab open, then start this script.',
    );
  }
}

assertNodeVersion();
prepareOneBotEnv();

runBot().catch((err) => {
  console.error('[bot:one] Failed:', err.message);
  process.exitCode = 1;
});
