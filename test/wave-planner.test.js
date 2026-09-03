import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  BOT_EXIT,
  classifyChildExit,
  exitCodeForError,
  MeetBlockedError,
  parseBotJoinLine,
} from '../lib/bot-result.js';
import {
  assertFleetAllowed,
  estimateJoinWaitMs,
  estimateMinRecordSeconds,
  planWaves,
  shouldAdvanceAfterJoins,
  shouldHardStopWave,
  summarizeWave,
} from '../lib/wave-planner.js';

describe('wave planner', () => {
  it('splits 100 guests into 10 waves of 10 with unique names', () => {
    const waves = planWaves({
      total: 100,
      waveSize: 10,
      startIndex: 0,
      namePrefix: 'PC1',
    });
    assert.equal(waves.length, 10);
    assert.equal(waves[0].bots[0].name, 'PC1-1');
    assert.equal(waves[9].bots[9].name, 'PC1-100');
    assert.equal(new Set(waves.flatMap((wave) => wave.bots.map((bot) => bot.name))).size, 100);
  });

  it('applies FLEET_OFFSET for a second local process', () => {
    const waves = planWaves({ total: 20, waveSize: 10, startIndex: 10, namePrefix: 'PC2' });
    assert.equal(waves[0].bots[0].name, 'PC2-11');
    assert.equal(waves[1].bots[9].name, 'PC2-30');
  });

  it('hard-stops when a majority of a wave is blocked', () => {
    assert.equal(shouldHardStopWave({ blockedCount: 6, waveSize: 10 }), true);
    assert.equal(shouldHardStopWave({ blockedCount: 4, waveSize: 10 }), false);
    const summary = summarizeWave([
      { status: 'in-call' },
      { status: 'blocked' },
      { status: 'blocked' },
      { status: 'blocked' },
      { status: 'blocked' },
      { status: 'blocked' },
      { status: 'blocked' },
      { status: 'not-in-call' },
      { status: 'fatal' },
      { status: 'in-call' },
    ]);
    assert.equal(summary.inCall, 2);
    assert.equal(summary.blocked, 6);
    assert.equal(summary.hardStop, true);
    assert.equal(shouldAdvanceAfterJoins(summary), false);
  });

  it('estimates join wait and minimum RECORD_SECONDS for overlapping waves', () => {
    assert.equal(estimateJoinWaitMs({
      joinTimeoutMs: 30000,
      admitWaitMs: 20000,
      bufferMs: 20000,
    }), 70000);
    assert.ok(estimateMinRecordSeconds({
      waveCount: 10,
      joinWaitMs: 70000,
      wavePauseMs: 8000,
      marginSeconds: 60,
    }) >= 800);
  });
});

describe('bot-join protocol', () => {
  it('parses [bot-join] even when the fleet prefixes the line', () => {
    const parsed = parseBotJoinLine('[PC1-3] [bot-join] {"status":"in-call","botName":"PC1-3"}');
    assert.equal(parsed.status, 'in-call');
    assert.equal(parsed.botName, 'PC1-3');
    assert.equal(parseBotJoinLine('[join] still on prejoin'), null);
    assert.equal(parseBotJoinLine('[bot-join] {"status":"nope"}'), null);
  });
});

describe('fleet live gate', () => {
  it('requires CONFIRM_LIVE and a real Meet URL for live fleets', () => {
    assert.throws(
      () => assertFleetAllowed({
        size: 10,
        meetUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        confirmLive: false,
      }),
      /CONFIRM_LIVE=true/,
    );
    assert.throws(
      () => assertFleetAllowed({
        size: 100,
        meetUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        confirmLive: false,
      }),
      /fleet:100/,
    );
    assert.throws(
      () => assertFleetAllowed({
        size: 10,
        meetUrl: 'https://meet.google.com/YOUR-MEET-CODE',
        confirmLive: true,
      }),
      /MEET_URL/,
    );
    assert.deepEqual(
      assertFleetAllowed({
        size: 10,
        meetUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        confirmLive: true,
      }),
      { mode: 'live', size: 10 },
    );
  });

  it('allows mock fleets only off Meet', () => {
    assert.deepEqual(
      assertFleetAllowed({ size: 10, meetUrl: 'file:///tmp/mock.html', mock: true }),
      { mode: 'mock', size: 10 },
    );
    assert.throws(
      () => assertFleetAllowed({
        size: 10,
        meetUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        mock: true,
      }),
      /FLEET_MOCK/,
    );
  });

  it('fleet:100 process refuses without CONFIRM_LIVE', async () => {
    const child = spawn(process.execPath, ['scripts/run-fleet-live.js', '--size=100'], {
      env: {
        ...process.env,
        MEET_URL: 'https://meet.google.com/aaa-bbbb-ccc',
        CONFIRM_LIVE: '',
        FLEET_MOCK: '',
      },
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.notEqual(code, 0);
    assert.match(stderr.join(''), /CONFIRM_LIVE|fleet:100|MEET_URL/);
  });
});

describe('bot exit codes', () => {
  it('maps blocked interstitial to exit 20', () => {
    assert.equal(exitCodeForError(new MeetBlockedError('you can\'t join')), BOT_EXIT.BLOCKED);
    assert.equal(classifyChildExit(20), 'blocked');
    assert.equal(classifyChildExit(0), 'in-call');
  });
});
