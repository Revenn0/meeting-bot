import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

describe('fleet safety', () => {
  it('refuses Google Meet unless ALLOW_LIVE_MEET=true', async () => {
    const child = spawn(process.execPath, ['scripts/run-fleet.js'], {
      env: {
        ...process.env,
        FLEET_SIZE: '1',
        MEET_URL: 'https://meet.google.com/aaa-bbbb-ccc',
        ALLOW_LIVE_MEET: '',
      },
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.notEqual(code, 0);
    assert.match(stderr.join(''), /Refusing to launch a fleet against Google Meet/);
  });
});
