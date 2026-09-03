export function computeStartupDelayMs({
  botIndex = 0,
  startupStaggerMs = 2000,
  startupConcurrency = 2,
  startupJitterMs = 0,
  random = Math.random,
} = {}) {
  const index = Math.max(0, botIndex);
  const concurrency = Math.max(1, startupConcurrency);
  const stagger = Math.max(0, startupStaggerMs);
  const wave = Math.floor(index / concurrency);
  const jitter = startupJitterMs > 0 ? Math.floor(random() * startupJitterMs) : 0;
  return wave * stagger + jitter;
}

export async function applyStartupGate(config, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const delayMs = computeStartupDelayMs(config);
  if (delayMs <= 0) {
    return { delayMs: 0 };
  }
  console.log(
    `[startup] Staggering launch by ${delayMs}ms (BOT_INDEX=${config.botIndex}, concurrency=${config.startupConcurrency}, stagger=${config.startupStaggerMs}ms).`,
  );
  await sleep(delayMs);
  return { delayMs };
}

export function createConcurrencyLimiter(limit) {
  const max = Math.max(1, limit);
  let active = 0;
  const queue = [];

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return async function runLimited(fn) {
    if (active >= max) {
      await new Promise((resolve) => queue.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
