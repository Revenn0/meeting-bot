import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { createPlateiaApp } from '../console/app.js';
import { createSettingsStore } from '../console/settings-store.js';
import { createSessionController } from '../console/session-controller.js';

function fakeLaunch(bot) {
  return {
    name: bot.name,
    botIndex: bot.botIndex,
    joinPromise: Promise.resolve({ name: bot.name, botIndex: bot.botIndex, status: 'in-call' }),
    exitPromise: Promise.resolve({ name: bot.name, botIndex: bot.botIndex, status: 'in-call', code: 0 }),
    child: { killed: true, kill() {} },
  };
}

describe('Plateia HTTP API', () => {
  let server;
  let base;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateia-http-'));
    const settingsStore = createSettingsStore({ userDataDir: dir });
    settingsStore.save({
      openrouterApiKey: 'sk-test',
      model: 'test/free:free',
      onboardingComplete: true,
    });
    const session = createSessionController({
      root: dir,
      settingsStore,
      launchGuest: fakeLaunch,
    });
    const openrouter = {
      async listFreeModels() {
        return [{ id: 'test/free:free', name: 'Test Free' }];
      },
      async complete({ messages }) {
        const content = messages.map((row) => row.content).join('\n');
        if (/BRIEF OBRIGATÓRIO|"bots"/.test(content)) {
          const count = Number(content.match(/Exatamente (\d+)/)?.[1] || 2);
          return {
            text: JSON.stringify({
              bots: Array.from({ length: count }, (_, i) => ({
                index: i + 1,
                name: `Plateia-${i + 1}`,
                messages: [
                  `Pergunta ${i + 1} sobre o pitch de energia`,
                  `Seguimento ${i + 1} do prazo`,
                ],
              })),
            }),
            model: 'test/free:free',
          };
        }
        return { text: '1) Join ok\n2) Risco: sala fechada\n3) Abrir a sala.', model: 'test/free:free' };
      },
      async testConnection() {
        return { ok: true, text: 'PLATEIA', model: 'test/free:free' };
      },
    };
    const { app } = createPlateiaApp({
      root: dir,
      settingsStore,
      session,
      openrouter,
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves health, settings, start, debrief and export', async () => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.maxBots, 15);

    const saved = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastTone: 'apoiador' }),
    }).then((r) => r.json());
    assert.equal(saved.settings.hasKey, true);
    assert.doesNotMatch(JSON.stringify(saved), /sk-test/);

    const models = await fetch(`${base}/api/models`).then((r) => r.json());
    assert.equal(models.models[0].id, 'test/free:free');

    const started = await fetch(`${base}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetUrl: 'https://meet.google.com/abc-defg-hij',
        botCount: 2,
        brief: 'Demo',
        enrichPhrases: false,
      }),
    }).then((r) => r.json());
    assert.equal(started.ok, true);
    assert.equal(started.session.bots.length, 2);

    await fetch(`${base}/api/session/stop`, { method: 'POST' });
    const debrief = await fetch(`${base}/api/debrief`, { method: 'POST' }).then((r) => r.json());
    assert.match(debrief.debrief, /Join ok/);

    const exported = await fetch(`${base}/api/debrief/export`).then((r) => r.text());
    assert.match(exported, /PLATEIA CONSOLE/);

    const reset = await fetch(`${base}/api/session/reset`, { method: 'POST' }).then((r) => r.json());
    assert.equal(reset.session.phase, 'idle');
  });

  it('previews a JSON fleet from mocked OpenRouter', async () => {
    const preview = await fetch(`${base}/api/phrases/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brief: 'Pitch de 8 minutos sobre energia solar',
        botCount: 3,
        tone: 'curioso',
        enrichPhrases: true,
      }),
    }).then((r) => r.json());
    assert.equal(preview.ok, true);
    assert.equal(preview.source, 'openrouter');
    assert.equal(preview.bots.length, 3);
    assert.equal(preview.bots[0].messages[0], 'Pergunta 1 sobre o pitch de energia');
    assert.notEqual(preview.bots[0].messages[0], preview.bots[1].messages[0]);
    assert.ok(preview.bots[0].messages.length >= 2);
  });

  it('returns 400 when enrich is on and the brief is empty', async () => {
    const res = await fetch(`${base}/api/phrases/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botCount: 2, enrichPhrases: true, brief: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /brief/i);
  });

  it('assigns unique AI lines per bot when starting a session', async () => {
    const started = await fetch(`${base}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetUrl: 'https://meet.google.com/xyz-abcd-efg',
        botCount: 2,
        brief: 'Ensaio sobre energia solar para PME',
        enrichPhrases: true,
      }),
    }).then((r) => r.json());
    assert.equal(started.ok, true);
    assert.equal(started.source, 'openrouter');
    assert.equal(started.session.bots[0].messages[0], 'Pergunta 1 sobre o pitch de energia');
    assert.equal(started.session.bots[1].messages[0], 'Pergunta 2 sobre o pitch de energia');
    await fetch(`${base}/api/session/stop`, { method: 'POST' });
    await fetch(`${base}/api/session/reset`, { method: 'POST' });
  });
});
