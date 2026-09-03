import { computeStartupDelayMs, createConcurrencyLimiter } from './startup-gate.js';
import { summarizeWave } from './wave-planner.js';

export async function launchWaveGuests({
  wave,
  concurrency,
  staggerMs,
  launchGuest,
  onLog = () => {},
}) {
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
      onLog(`[fleet] Launching ${bot.name}`);
      return launchGuest({ ...bot, indexInWave });
    }),
  ));
}

export async function waitForWaveJoins(guests, { timeoutMs } = {}) {
  return Promise.all(guests.map((guest) => {
    const join = guest.joinPromise;
    if (!timeoutMs) return join;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          name: guest.name,
          botIndex: guest.botIndex,
          status: 'fatal',
          reason: 'join-timeout',
        });
      }, timeoutMs);
      join.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          resolve({
            name: guest.name,
            botIndex: guest.botIndex,
            status: 'fatal',
            reason: error?.message || 'join-rejected',
          });
        },
      );
    });
  }));
}

/**
 * Launch waves of guests. The next wave starts after this wave has *joined*
 * (or failed to join) — previous guests stay in-call until RECORD_SECONDS.
 * Hard-stop if a wave majority hits Meet's can't-join interstitial.
 */
export async function runAccumulatingFleet({
  waves,
  launchGuest,
  concurrency,
  staggerMs,
  wavePauseMs,
  joinTimeoutMs,
  onLog = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const totals = {
    'in-call': 0,
    blocked: 0,
    'not-in-call': 0,
    fatal: 0,
  };
  const allGuests = [];
  let hardStop = false;
  let wavesCompleted = 0;
  let hardStopMessage = null;

  for (const wave of waves) {
    onLog(`[fleet] === Wave ${wave.waveIndex + 1}/${waves.length} (${wave.size} guests) ===`);
    const guests = await launchWaveGuests({
      wave,
      concurrency,
      staggerMs,
      launchGuest,
      onLog,
    });
    allGuests.push(...guests);

    const results = await waitForWaveJoins(guests, { timeoutMs: joinTimeoutMs });
    const summary = summarizeWave(results);
    totals['in-call'] += summary.inCall;
    totals.blocked += summary.blocked;
    totals['not-in-call'] += summary.notInCall;
    totals.fatal += summary.fatal;
    wavesCompleted += 1;

    onLog(
      `[fleet] Wave ${wave.waveIndex + 1} joined in-call=${summary.inCall} blocked=${summary.blocked} `
        + `not-in-call=${summary.notInCall} fatal=${summary.fatal} accumulated-in-call=${totals['in-call']}`,
    );

    if (summary.hardStop) {
      hardStop = true;
      hardStopMessage = (
        `HARD STOP: ${summary.blocked}/${summary.size} guests in wave ${wave.waveIndex + 1} `
        + `hit Meet's "You can't join" interstitial. Not launching more waves. `
        + `Guests already in-call stay until RECORD_SECONDS.`
      );
      onLog(`[fleet] ${hardStopMessage}`);
      break;
    }

    if (wave.waveIndex < waves.length - 1 && wavePauseMs > 0) {
      onLog(`[fleet] Pause ${wavePauseMs}ms before next wave (previous guests stay in-call)...`);
      await sleep(wavePauseMs);
    }
  }

  onLog('[fleet] Waiting for in-call guests to finish RECORD_SECONDS...');
  const exits = await Promise.all(allGuests.map((guest) => guest.exitPromise));

  return {
    totals,
    hardStop,
    hardStopMessage,
    wavesCompleted,
    guests: allGuests,
    exits,
  };
}
