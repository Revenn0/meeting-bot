export function computeMessageTicks({ durationMs, intervalMs, initialDelayMs = 0 }) {
  if (intervalMs <= 0) {
    throw new Error('intervalMs must be positive.');
  }
  if (durationMs < 0) {
    throw new Error('durationMs must be non-negative.');
  }
  if (initialDelayMs < 0) {
    throw new Error('initialDelayMs must be non-negative.');
  }

  const ticks = [];
  let at = initialDelayMs;
  while (at <= durationMs) {
    ticks.push(at);
    at += intervalMs;
  }
  return ticks;
}

export function createMessageScheduler({
  intervalMs,
  durationMs,
  onSend,
  initialDelayMs = intervalMs,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = clearTimeout,
}) {
  if (typeof onSend !== 'function') {
    throw new Error('onSend must be a function.');
  }

  const timers = new Set();
  let running = false;
  let cancelled = false;
  let inFlight = false;

  const schedule = (delayMs, fn) => {
    const id = setTimer(async () => {
      timers.delete(id);
      await fn();
    }, delayMs);
    timers.add(id);
    return id;
  };

  const start = () => {
    if (running) {
      return { stop: cleanup };
    }
    running = true;
    cancelled = false;

    const ticks = computeMessageTicks({ durationMs, intervalMs, initialDelayMs });
    for (const tick of ticks) {
      schedule(tick, async () => {
        if (cancelled || inFlight) {
          return;
        }
        inFlight = true;
        try {
          await onSend();
        } finally {
          inFlight = false;
        }
      });
    }

    return { stop: cleanup };
  };

  function cleanup() {
    cancelled = true;
    for (const id of timers) {
      clearTimer(id);
    }
    timers.clear();
    running = false;
  }

  return { start, stop: cleanup, get pendingCount() { return timers.size; } };
}
