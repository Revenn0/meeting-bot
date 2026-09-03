import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMessageScheduler } from '../lib/message-scheduler.js';

describe('cleanup', () => {
  it('clears pending timers on stop', () => {
    let cleared = 0;
    const ids = [];

    const scheduler = createMessageScheduler({
      intervalMs: 500,
      durationMs: 5000,
      setTimer: (fn, ms) => {
        const id = { fn, ms };
        ids.push(id);
        return id;
      },
      clearTimer: () => {
        cleared += 1;
      },
      onSend: async () => {},
    });

    scheduler.start();
    assert.ok(scheduler.pendingCount > 0);
    scheduler.stop();
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(cleared, ids.length);
  });
});
