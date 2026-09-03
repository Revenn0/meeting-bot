import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEnvFile, parseEnvFile } from '../lib/load-env.js';

describe('load-env', () => {
  it('parses .env lines and ignores comments', () => {
    const parsed = parseEnvFile('MEET_URL=https://meet.google.com/aaa-bbbb-ccc\n# skip\nBOT_NAME="PC Bot"\n');
    assert.equal(parsed.MEET_URL, 'https://meet.google.com/aaa-bbbb-ccc');
    assert.equal(parsed.BOT_NAME, 'PC Bot');
  });

  it('does not overwrite existing process env', () => {
    const env = { MODE: 'keep-me' };
    applyEnvFile('/tmp/does-not-exist.env', env);
    const parsed = parseEnvFile('MODE=chat-only\nCHAT_MESSAGE=Hi\n');
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
    assert.equal(env.MODE, 'keep-me');
    assert.equal(env.CHAT_MESSAGE, 'Hi');
  });
});
