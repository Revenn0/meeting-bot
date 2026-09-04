import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSettingsStore, maskKey } from '../console/settings-store.js';

describe('settings store', () => {
  it('writes the API key to user-data/.env and hides it in the public view', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateia-settings-'));
    const store = createSettingsStore({ userDataDir: dir });
    store.save({ openrouterApiKey: 'sk-or-v1-abcdefghijklmnop', model: 'test/free:free' });
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    assert.match(env, /OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop/);
    const pub = store.publicView();
    assert.equal(pub.hasKey, true);
    assert.equal(pub.model, 'test/free:free');
    assert.doesNotMatch(JSON.stringify(pub), /sk-or-v1-abcdefghijklmnop/);
    assert.equal(maskKey('sk-or-v1-abcdefghijklmnop').includes('mnop'), true);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(disk.openrouterApiKey, undefined);
  });

  it('persists skippedUpdateVersion without exposing the API key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateia-skip-'));
    const store = createSettingsStore({ userDataDir: dir });
    store.save({ openrouterApiKey: 'sk-secret-key-value', skippedUpdateVersion: '2.1.0' });
    const pub = store.publicView();
    assert.equal(pub.skippedUpdateVersion, '2.1.0');
    assert.equal(store.load().skippedUpdateVersion, '2.1.0');
    assert.doesNotMatch(JSON.stringify(pub), /sk-secret-key-value/);
  });
});
