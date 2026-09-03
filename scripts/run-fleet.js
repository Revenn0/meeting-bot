import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStartupDelayMs } from '../lib/startup-gate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertSafeTarget(meetUrl) {
  const allowLive = process.env.ALLOW_LIVE_MEET === 'true';
  const isMeet = /meet\.google\.com/i.test(meetUrl || '');
  if (isMeet && !allowLive) {
    throw new Error(
      'Refusing to launch a fleet against Google Meet. Use a local file:// or example.invalid URL, or set ALLOW_LIVE_MEET=true for a later controlled live test.',
    );
  }
}

async function main() {
  const count = Number.parseInt(process.env.FLEET_SIZE || '3', 10);
  if (!Number.isFinite(count) || count < 1 || count > 5) {
    throw new Error('FLEET_SIZE must be 1-5 for local browser runs (use in-process loadtest for larger scales).');
  }

  const meetUrl = process.env.MEET_URL || `file://${path.join(root, 'test/fixtures/mock-meet-chat.html')}`;
  assertSafeTarget(meetUrl);

  const concurrency = Number.parseInt(process.env.STARTUP_CONCURRENCY || '2', 10);
  const staggerMs = Number.parseInt(process.env.STARTUP_STAGGER_MS || '2500', 10);
  const t0 = Date.now();

  console.log(`[fleet] Starting ${count} isolated chat-only guests (concurrency=${concurrency}, stagger=${staggerMs}ms).`);
  console.log('[fleet] Target:', meetUrl);

  const exits = [];
  for (let index = 0; index < count; index += 1) {
    const delay = computeStartupDelayMs({
      botIndex: index,
      startupStaggerMs: staggerMs,
      startupConcurrency: concurrency,
      startupJitterMs: 0,
    });
    const wait = delay - (Date.now() - t0);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    const child = spawn(process.execPath, ['bot.js'], {
      cwd: root,
      env: {
        ...process.env,
        MODE: 'chat-only',
        MEET_URL: meetUrl,
        BOT_NAME: process.env.BOT_NAME_PREFIX
          ? `${process.env.BOT_NAME_PREFIX}-${index + 1}`
          : `ChatBot-${index + 1}`,
        BOT_INDEX: String(index),
        STARTUP_STAGGER_MS: '0',
        STARTUP_JITTER_MS: '0',
        RECORD_SECONDS: process.env.RECORD_SECONDS || '8',
        ADMIT_WAIT_MS: process.env.ADMIT_WAIT_MS || '500',
      },
      stdio: 'inherit',
    });

    exits.push(new Promise((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`bot ${index + 1} exited ${code}`));
      });
    }));
  }

  await Promise.all(exits);
  console.log('[fleet] All local guests finished:', count);
}

main().catch((error) => {
  console.error('[fleet]', error.message);
  process.exitCode = 1;
});
