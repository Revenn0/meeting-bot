import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createChatOnlyBotSimulator,
  createSimulatedBotFleet,
  runSimulatedChatOnlyFleet,
} from '../lib/sim/chat-only-simulator.js';

describe('chat-only simulator', () => {
  it('creates unique bot names and uses non-routable meet URL', () => {
    const fleet = createSimulatedBotFleet(3);
    const names = fleet.map((bot) => bot.config.botName);
    assert.deepEqual(names, ['SimBot-1', 'SimBot-2', 'SimBot-3']);
    assert.match(fleet[0].config.meetUrl, /example\.invalid/);
  });

  it('sends scheduled messages with fake timers', async () => {
    const timers = new Map();
    let now = 0;

    const bot = createChatOnlyBotSimulator({
      botName: 'TimerBot',
      recordSeconds: 2,
      chatIntervalMs: 1000,
      setTimer: (fn, ms) => {
        const id = Symbol(String(ms));
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
    });

    bot.start();

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

    assert.equal(bot.sentMessages, 2);
    bot.stop();
    assert.equal(bot.pendingTimers, 0);
  });

  it('runs a concurrent fleet without network access', async () => {
    const result = await runSimulatedChatOnlyFleet({
      botCount: 5,
      recordSeconds: 1,
      chatIntervalMs: 1000,
      settleBufferMs: 50,
    });

    assert.equal(result.botCount, 5);
    assert.equal(result.uniqueBotNames, 5);
    assert.equal(result.totalMessages, 5);
    assert.equal(result.pendingTimers, 0);
  });
});
