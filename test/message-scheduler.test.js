import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMessageTicks, createMessageScheduler } from '../lib/message-scheduler.js';

describe('message scheduler', () => {
  it('computes ticks within duration', () => {
    assert.deepEqual(
      computeMessageTicks({ durationMs: 10000, intervalMs: 3000, initialDelayMs: 2000 }),
      [2000, 5000, 8000],
    );
  });

  it('sends at controlled intervals and supports cleanup', async () => {
    const timers = new Map();
    let now = 0;
    const sentAt = [];

    const setTimer = (fn, ms) => {
      const id = Symbol(String(ms));
      timers.set(id, { fn, at: now + ms });
      return id;
    };
    const clearTimer = (id) => {
      timers.delete(id);
    };

    const scheduler = createMessageScheduler({
      intervalMs: 1000,
      durationMs: 2500,
      initialDelayMs: 1000,
      setTimer,
      clearTimer,
      onSend: async () => {
        sentAt.push(now);
      },
    });

    scheduler.start();

    while (timers.size > 0) {
      const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
      now = next.at;
      const due = [...timers.entries()].filter(([, entry]) => entry.at <= now);
      for (const [, entry] of due) {
        await entry.fn();
      }
      for (const [id, entry] of [...timers.entries()]) {
        if (entry.at <= now) {
          timers.delete(id);
        }
      }
    }

    assert.deepEqual(sentAt, [1000, 2000]);

    scheduler.stop();
    assert.equal(scheduler.pendingCount, 0);
  });
});
