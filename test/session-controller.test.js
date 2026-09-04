import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSettingsStore } from '../console/settings-store.js';
import { buildGuestChatEnv, createSessionController } from '../console/session-controller.js';

function fakeLaunch(bot, { stayMs = 80, status = 'in-call' } = {}) {
  const joinPromise = Promise.resolve({ name: bot.name, botIndex: bot.botIndex, status });
  const exitPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({ name: bot.name, botIndex: bot.botIndex, status, code: 0 });
    }, stayMs);
  });
  return {
    name: bot.name,
    botIndex: bot.botIndex,
    joinPromise,
    exitPromise,
    child: { killed: false, kill() { this.killed = true; } },
  };
}

describe('session controller', () => {
  it('starts a capped rehearsal, tracks bots, then debriefs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateia-session-'));
    const settingsStore = createSettingsStore({ userDataDir: dir });
    const controller = createSessionController({
      root: dir,
      settingsStore,
      launchGuest: (bot) => fakeLaunch(bot),
    });

    await assert.rejects(
      () => controller.start({
        meetUrl: 'https://meet.google.com/abc-defg-hij',
        botCount: 16,
      }),
      /cannot exceed 15/,
    );

    const started = await controller.start({
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      botCount: 3,
      brief: 'Ensaio de vendas',
      tone: 'direto',
      recordSeconds: 30,
    });
    assert.equal(started.phase, 'live');
    assert.equal(started.bots.length, 3);
    assert.equal(started.maxBots, 15);
    assert.ok(fs.existsSync(controller.controlFile));

    const paused = await controller.pause();
    assert.equal(paused.phase, 'paused');
    const control = JSON.parse(fs.readFileSync(controller.controlFile, 'utf8'));
    assert.equal(control.paused, true);

    await controller.resume();
    const stopped = await controller.stop();
    assert.equal(stopped.phase, 'ended');
    const after = controller.setDebrief({ text: 'Bom join.', model: 'test/free' });
    assert.equal(after.debriefText, 'Bom join.');
    const idle = controller.reset();
    assert.equal(idle.phase, 'idle');
    assert.equal(idle.bots.length, 0);
  });

  it('passes a distinct CHAT_MESSAGES_JSON to each spawned guest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateia-env-'));
    const settingsStore = createSettingsStore({ userDataDir: dir });
    const envs = [];
    const controller = createSessionController({
      root: dir,
      settingsStore,
      spawnGuest: ({ name, botIndex, extraEnv }) => {
        envs.push({ name, botIndex, extraEnv });
        return fakeLaunch({ name, botIndex });
      },
    });

    const env = buildGuestChatEnv({
      messages: ['alpha', 'alpha2'],
      recordSeconds: 30,
      chatIntervalMs: 8000,
      showChrome: true,
      controlFile: '/tmp/ctl.json',
    });
    assert.equal(env.CHAT_MESSAGE, 'alpha');
    assert.deepEqual(JSON.parse(env.CHAT_MESSAGES_JSON), ['alpha', 'alpha2']);

    await controller.start({
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      botCount: 2,
      brief: 'Ensaio de vendas',
      recordSeconds: 30,
      fleet: {
        source: 'openrouter',
        bots: [
          { index: 1, name: 'Plateia-1', messages: ['alpha', 'alpha2'] },
          { index: 2, name: 'Plateia-2', messages: ['beta', 'beta2'] },
        ],
      },
      phraseSource: 'openrouter',
    });

    const deadline = Date.now() + 2000;
    while (envs.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(envs.length, 2);
    assert.equal(envs[0].extraEnv.CHAT_MESSAGE, 'alpha');
    assert.deepEqual(JSON.parse(envs[0].extraEnv.CHAT_MESSAGES_JSON), ['alpha', 'alpha2']);
    assert.equal(envs[1].extraEnv.CHAT_MESSAGE, 'beta');
    assert.deepEqual(JSON.parse(envs[1].extraEnv.CHAT_MESSAGES_JSON), ['beta', 'beta2']);
    await controller.stop();
  });
});
