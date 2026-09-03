import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../lib/load-env.js';
import { classifyChildExit } from '../lib/bot-result.js';
import { computeStartupDelayMs, createConcurrencyLimiter } from '../lib/startup-gate.js';
import { assertFleetAllowed, planWaves, summarizeWave } from '../lib/wave-planner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseSize(argv) {
  const flag = argv.find((arg) => arg.startsWith('--size='));
  if (flag) return Number.parseInt(flag.slice('--size='.length), 10);
  return Number.parseInt(process.env.FLEET_SIZE || '10', 10);
}

function spawnGuest({ name, botIndex, meetUrl }) {
  const child = spawn(process.execPath, ['bot.js'], {
    cwd: root,
    env: {
      ...process.env,
      MODE: 'chat-only',
      MEET_URL: meetUrl,
      BOT_NAME: name,
      BOT_INDEX: String(botIndex),
      STARTUP_STAGGER_MS: '0',
      STARTUP_JITTER_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${name}] `;
  const forward = (stream, dest) => {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line) dest.write(`${prefix}${line}\n`);
      }
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  return new Promise((resolve) => {
    child.on('close', (code) => {
      resolve({
        name,
        botIndex,
        code: code ?? 1,
        status: classifyChildExit(code ?? 1),
      });
    });
  });
}

async function runWave(wave, { meetUrl, concurrency, staggerMs }) {
  const limiter = createConcurrencyLimiter(concurrency);
  const t0 = Date.now();

  return Promise.all(wave.bots.map((bot, indexInWave) =>
    limiter(async () => {
      const delay = computeStartupDelayMs({
        botIndex: indexInWave,
        startupStaggerMs: staggerMs,
        startupConcurrency: concurrency,
        startupJitterMs: 0,
      });
      const wait = delay - (Date.now() - t0);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      console.log(`[fleet] Launching ${bot.name}`);
      return spawnGuest({ ...bot, meetUrl });
    }),
  ));
}

async function main() {
  loadLocalEnv(root);

  const size = parseSize(process.argv.slice(2));
  if (!Number.isFinite(size) || size < 1) {
    throw new Error('FLEET_SIZE / --size must be a positive integer.');
  }

  const mock = process.env.FLEET_MOCK === 'true';
  const meetUrl = mock
    ? (process.env.MEET_URL || `file://${path.join(root, 'test/fixtures/mock-meet-chat.html')}?delay=40`)
    : process.env.MEET_URL;
  const confirmLive = process.env.CONFIRM_LIVE === 'true';

  const allowed = assertFleetAllowed({ size, meetUrl, confirmLive, mock });
  const waveSize = Number.parseInt(process.env.WAVE_SIZE || '10', 10);
  const concurrency = Number.parseInt(process.env.STARTUP_CONCURRENCY || '2', 10);
  const staggerMs = Number.parseInt(process.env.STARTUP_STAGGER_MS || '0', 10);
  const wavePauseMs = Number.parseInt(process.env.WAVE_PAUSE_MS || '8000', 10);
  const startIndex = Number.parseInt(process.env.FLEET_OFFSET || '0', 10);
  const namePrefix = process.env.BOT_NAME_PREFIX || process.env.FLEET_NAME_PREFIX || 'Fleet';

  const waves = planWaves({
    total: size,
    waveSize,
    startIndex,
    namePrefix,
  });

  console.log(`[fleet] mode=${allowed.mode} size=${size} waves=${waves.length} waveSize=${waveSize}`);
  console.log(`[fleet] concurrency=${concurrency} staggerMs=${staggerMs} prefix=${namePrefix} offset=${startIndex}`);
  console.log('[fleet] Target:', meetUrl);
  console.log('[fleet] Hard-stop if ≥50% of a wave hits "You can\'t join".');

  const totals = {
    'in-call': 0,
    blocked: 0,
    'not-in-call': 0,
    fatal: 0,
  };

  for (const wave of waves) {
    console.log(`[fleet] === Wave ${wave.waveIndex + 1}/${waves.length} (${wave.size} guests) ===`);
    const results = await runWave(wave, { meetUrl, concurrency, staggerMs });
    const summary = summarizeWave(results);
    totals['in-call'] += summary.inCall;
    totals.blocked += summary.blocked;
    totals['not-in-call'] += summary.notInCall;
    totals.fatal += summary.fatal;

    console.log(
      `[fleet] Wave ${wave.waveIndex + 1} in-call=${summary.inCall} blocked=${summary.blocked} `
        + `not-in-call=${summary.notInCall} fatal=${summary.fatal} accumulated-in-call=${totals['in-call']}`,
    );

    if (summary.hardStop) {
      throw new Error(
        `HARD STOP: ${summary.blocked}/${summary.size} guests in wave ${wave.waveIndex + 1} `
          + `hit Meet's "You can't join" interstitial. Do not launch more waves.`,
      );
    }

    if (wave.waveIndex < waves.length - 1 && wavePauseMs > 0) {
      console.log(`[fleet] Pause ${wavePauseMs}ms before next wave...`);
      await new Promise((resolve) => setTimeout(resolve, wavePauseMs));
    }
  }

  console.log('[fleet] Done.', JSON.stringify({ totals, target: size }));
  if (totals['in-call'] === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[fleet]', error.message);
  process.exitCode = 1;
});
