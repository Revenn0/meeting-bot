import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyStartupGate, computeStartupDelayMs, createConcurrencyLimiter } from '../lib/startup-gate.js';

describe('startup gate', () => {
  it('staggers later bots into waves', () => {
    assert.equal(computeStartupDelayMs({ botIndex: 0, startupStaggerMs: 2000, startupConcurrency: 2 }), 0);
    assert.equal(computeStartupDelayMs({ botIndex: 1, startupStaggerMs: 2000, startupConcurrency: 2 }), 0);
    assert.equal(computeStartupDelayMs({ botIndex: 2, startupStaggerMs: 2000, startupConcurrency: 2 }), 2000);
    assert.equal(computeStartupDelayMs({ botIndex: 5, startupStaggerMs: 2000, startupConcurrency: 2 }), 4000);
  });

  it('applies delay through the gate', async () => {
    const slept = [];
    await applyStartupGate(
      { botIndex: 4, startupStaggerMs: 1000, startupConcurrency: 2, startupJitterMs: 0 },
      { sleep: async (ms) => slept.push(ms) },
    );
    assert.deepEqual(slept, [2000]);
  });

  it('limits concurrency', async () => {
    const run = createConcurrencyLimiter(2);
    let current = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 5 }, () =>
      run(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise((resolve) => setTimeout(resolve, 20));
        current -= 1;
      }),
    ));
    assert.equal(peak, 2);
  });
});
