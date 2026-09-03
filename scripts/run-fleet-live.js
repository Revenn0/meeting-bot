import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../lib/load-env.js';
import { runAccumulatingFleet } from '../lib/fleet-runner.js';
import { resolveFleetChildEntry, spawnLiveGuest } from '../lib/fleet-spawn.js';
import {
  assertFleetAllowed,
  estimateJoinWaitMs,
  estimateMinRecordSeconds,
  planWaves,
} from '../lib/wave-planner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseSize(argv) {
  const flag = argv.find((arg) => arg.startsWith('--size='));
  if (flag) return Number.parseInt(flag.slice('--size='.length), 10);
  return Number.parseInt(process.env.FLEET_SIZE || '10', 10);
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
  const joinTimeoutMs = process.env.JOIN_WAIT_MS
    ? Number.parseInt(process.env.JOIN_WAIT_MS, 10)
    : estimateJoinWaitMs({
      joinTimeoutMs: Number.parseInt(process.env.JOIN_TIMEOUT_MS || '30000', 10),
      admitWaitMs: Number.parseInt(process.env.ADMIT_WAIT_MS || '20000', 10),
    });
  const recordSeconds = Number.parseInt(process.env.RECORD_SECONDS || '15', 10);
  const waves = planWaves({
    total: size,
    waveSize,
    startIndex,
    namePrefix,
  });
  const minRecord = estimateMinRecordSeconds({
    waveCount: waves.length,
    joinWaitMs: joinTimeoutMs,
    wavePauseMs,
  });

  const childEntry = resolveFleetChildEntry({
    mock,
    childEntry: process.env.FLEET_CHILD,
  });

  console.log(`[fleet] child=${childEntry}`);
  console.log(`[fleet] mode=${allowed.mode} size=${size} waves=${waves.length} waveSize=${waveSize}`);
  console.log(`[fleet] concurrency=${concurrency} staggerMs=${staggerMs} prefix=${namePrefix} offset=${startIndex}`);
  console.log(`[fleet] joinWaitMs=${joinTimeoutMs} RECORD_SECONDS=${recordSeconds} (recommend ≥ ${minRecord} so waves overlap)`);
  console.log('[fleet] Target:', meetUrl);
  console.log('[fleet] Next wave starts after this wave JOINS (Leave call), not after guests leave.');
  console.log('[fleet] Hard-stop if ≥50% of a wave hits "You can\'t join".');

  if (!mock && recordSeconds < minRecord) {
    console.warn(
      `[fleet] WARNING: RECORD_SECONDS=${recordSeconds} is shorter than ~${minRecord}s needed `
        + `for ${waves.length} waves to accumulate. Early guests may leave before later waves join.`,
    );
  }

  const liveGuests = [];
  const launchGuest = (bot) => {
    const guest = spawnLiveGuest({
      ...bot,
      meetUrl,
      root,
      childEntry,
    });
    liveGuests.push(guest);
    return guest;
  };

  const stopChildren = (signal = 'SIGTERM') => {
    for (const guest of liveGuests) {
      if (guest.child && !guest.child.killed) {
        guest.child.kill(signal);
      }
    }
  };

  const onSignal = (signal) => {
    console.error(`[fleet] ${signal} — stopping remaining guests.`);
    stopChildren('SIGTERM');
    process.exit(130);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const result = await runAccumulatingFleet({
    waves,
    launchGuest,
    concurrency,
    staggerMs,
    wavePauseMs,
    joinTimeoutMs,
  });

  console.log('[fleet] Done.', JSON.stringify({
    totals: result.totals,
    target: size,
    accumulatedInCall: result.totals['in-call'],
    wavesCompleted: result.wavesCompleted,
    hardStop: result.hardStop,
  }));

  if (result.hardStop) {
    throw new Error(result.hardStopMessage);
  }
  if (result.totals['in-call'] === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[fleet]', error.message);
  process.exitCode = 1;
});
