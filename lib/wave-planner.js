export const DEFAULT_WAVE_SIZE = 10;
export const DEFAULT_BLOCKED_FRACTION = 0.5;

export function planWaves({
  total,
  waveSize = DEFAULT_WAVE_SIZE,
  startIndex = 0,
  namePrefix = 'Fleet',
} = {}) {
  const count = Math.max(0, Number(total) || 0);
  const size = Math.max(1, Number(waveSize) || DEFAULT_WAVE_SIZE);
  const offset = Math.max(0, Number(startIndex) || 0);
  const prefix = String(namePrefix || 'Fleet').replace(/\s+/g, '-');

  const waves = [];
  for (let i = 0; i < count; i += size) {
    const length = Math.min(size, count - i);
    const bots = Array.from({ length }, (_, j) => {
      const botIndex = offset + i + j;
      return {
        botIndex,
        name: `${prefix}-${botIndex + 1}`,
      };
    });
    waves.push({
      waveIndex: waves.length,
      startBotIndex: offset + i,
      size: length,
      bots,
    });
  }
  return waves;
}

export function shouldHardStopWave({
  blockedCount,
  waveSize,
  threshold = DEFAULT_BLOCKED_FRACTION,
} = {}) {
  const size = Math.max(1, Number(waveSize) || 0);
  const blocked = Math.max(0, Number(blockedCount) || 0);
  return blocked / size >= threshold;
}

export function summarizeWave(results = []) {
  const counts = {
    'in-call': 0,
    blocked: 0,
    'not-in-call': 0,
    fatal: 0,
  };
  for (const result of results) {
    counts[result.status] = (counts[result.status] || 0) + 1;
  }
  return {
    size: results.length,
    inCall: counts['in-call'],
    blocked: counts.blocked,
    notInCall: counts['not-in-call'],
    fatal: counts.fatal,
    hardStop: shouldHardStopWave({
      blockedCount: counts.blocked,
      waveSize: results.length || 1,
    }),
  };
}

export function assertFleetAllowed({
  size,
  meetUrl,
  confirmLive,
  mock = false,
} = {}) {
  const target = String(meetUrl || '');
  const isMeet = /meet\.google\.com/i.test(target);
  const placeholder = /YOUR-MEET-CODE/i.test(target);

  if (mock) {
    if (isMeet) {
      throw new Error('FLEET_MOCK=true cannot target meet.google.com.');
    }
    return { mode: 'mock', size };
  }

  if (!isMeet || placeholder) {
    throw new Error(
      'Set MEET_URL to an open Google Meet link before running a live fleet.',
    );
  }

  if (Number(size) >= 100 && confirmLive !== true) {
    throw new Error(
      'fleet:100 requires CONFIRM_LIVE=true and a real MEET_URL. This is a live Meet join.',
    );
  }

  if (confirmLive !== true) {
    throw new Error(
      'Live fleet requires CONFIRM_LIVE=true (and an open MEET_URL). Refusing to start.',
    );
  }

  return { mode: 'live', size };
}
