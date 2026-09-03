import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runAccumulatingFleet } from '../lib/fleet-runner.js';
import { resolveFleetChildEntry } from '../lib/fleet-spawn.js';
import { planWaves } from '../lib/wave-planner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeGuest({ status = 'in-call', stayMs = 180 } = {}) {
  return ({ name, botIndex }) => {
    let live = true;
    const joinPromise = Promise.resolve({ name, botIndex, status });
    const exitPromise = new Promise((resolve) => {
      setTimeout(() => {
        live = false;
        resolve({
          name,
          botIndex,
          code: status === 'in-call' ? 0 : 20,
          status,
        });
      }, stayMs);
    });
    return {
      name,
      botIndex,
      joinPromise,
      exitPromise,
      isLive: () => live,
    };
  };
}

describe('accumulating fleet runner', () => {
  it('starts the next wave after joins while previous guests stay in-call', async () => {
    const stayMs = 220;
    const guests = [];
    const launchTimes = [];
    const launchGuest = (bot) => {
      launchTimes.push({ name: bot.name, at: Date.now() });
      const guest = fakeGuest({ stayMs })(bot);
      guests.push(guest);
      return guest;
    };

    const t0 = Date.now();
    const result = await runAccumulatingFleet({
      waves: planWaves({ total: 20, waveSize: 10, namePrefix: 'T' }),
      launchGuest,
      concurrency: 10,
      staggerMs: 0,
      wavePauseMs: 0,
      joinTimeoutMs: 1000,
      onLog: () => {},
    });

    const wave2Launch = launchTimes.find((row) => row.name === 'T-11');
    assert.ok(wave2Launch, 'wave 2 must launch');
    assert.ok(
      wave2Launch.at - t0 < stayMs,
      `wave 2 launched at +${wave2Launch.at - t0}ms; must be before wave 1 exit (${stayMs}ms)`,
    );
    assert.equal(result.totals['in-call'], 20);
    assert.equal(result.hardStop, false);
    assert.equal(result.wavesCompleted, 2);
    assert.equal(guests.length, 20);
  });

  it('hard-stops and does not launch the next wave when a majority is blocked', async () => {
    let launched = 0;
    const launchGuest = ({ name, botIndex }) => {
      launched += 1;
      const status = botIndex < 6 ? 'blocked' : 'in-call';
      return fakeGuest({ status, stayMs: 20 })({ name, botIndex });
    };

    const result = await runAccumulatingFleet({
      waves: planWaves({ total: 30, waveSize: 10, namePrefix: 'B' }),
      launchGuest,
      concurrency: 10,
      staggerMs: 0,
      wavePauseMs: 0,
      joinTimeoutMs: 500,
      onLog: () => {},
    });

    assert.equal(result.hardStop, true);
    assert.equal(result.wavesCompleted, 1);
    assert.equal(launched, 10);
    assert.equal(result.totals.blocked, 6);
    assert.equal(result.totals['in-call'], 4);
  });
});

describe('fleet mock process (no Meet)', () => {
  it('resolves FLEET_CHILD only in mock mode', () => {
    assert.equal(resolveFleetChildEntry({ mock: false, childEntry: 'test/fixtures/fake-guest.js' }), 'bot.js');
    assert.equal(
      resolveFleetChildEntry({ mock: true, childEntry: 'test/fixtures/fake-guest.js' }),
      'test/fixtures/fake-guest.js',
    );
  });

  it('fleet:10 mock launches wave 2 before wave 1 exits', async () => {
    const child = spawn(process.execPath, ['scripts/run-fleet-live.js', '--size=20'], {
      cwd: root,
      env: {
        ...process.env,
        FLEET_MOCK: 'true',
        FLEET_CHILD: 'test/fixtures/fake-guest.js',
        FLEET_SIZE: '20',
        WAVE_SIZE: '10',
        WAVE_PAUSE_MS: '0',
        STARTUP_CONCURRENCY: '10',
        STARTUP_STAGGER_MS: '0',
        JOIN_WAIT_MS: '2000',
        FAKE_STAY_MS: '400',
        FAKE_JOIN_STATUS: 'in-call',
        MEET_URL: `file://${path.join(root, 'test/fixtures/mock-meet-chat.html')}`,
        CONFIRM_LIVE: '',
        RECORD_SECONDS: '1',
      },
    });
    const out = [];
    child.stdout.on('data', (chunk) => out.push(chunk.toString()));
    child.stderr.on('data', (chunk) => out.push(chunk.toString()));
    const code = await new Promise((resolve) => child.on('close', resolve));
    const text = out.join('');
    assert.equal(code, 0, text);
    assert.match(text, /Wave 2\/2/);
    assert.match(text, /accumulated-in-call=20/);
    assert.match(text, /Next wave starts after this wave JOINS/);
  });

  it('fleet:100 refuses without CONFIRM_LIVE and MEET_URL', async () => {
    const child = spawn(process.execPath, ['scripts/run-fleet-live.js', '--size=100'], {
      cwd: root,
      env: {
        ...process.env,
        MEET_URL: '',
        CONFIRM_LIVE: '',
        FLEET_MOCK: '',
      },
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.notEqual(code, 0);
    assert.match(stderr.join(''), /MEET_URL|CONFIRM_LIVE|fleet:100/);
  });
});
