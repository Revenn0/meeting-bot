import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../lib/config.js';
import { buildLaunchArgs } from '../lib/browser.js';
import {
  CHROMIUM_FLAG_DOCS,
  CHROMIUM_PROFILES,
  documentFlags,
  normalizeChromiumProfile,
} from '../lib/chromium-flags.js';

describe('chromium profiles', () => {
  it('defaults chat-only to chat-slim and recording to recording', () => {
    assert.equal(normalizeChromiumProfile('', { chatOnly: true }), CHROMIUM_PROFILES.CHAT_SLIM);
    assert.equal(normalizeChromiumProfile('', { chatOnly: false }), CHROMIUM_PROFILES.RECORDING);
  });

  it('keeps recording flags unchanged in default mode', () => {
    const config = loadConfig({});
    const args = buildLaunchArgs(config, {
      videoPath: '/tmp/fake_video.y4m',
      audioPath: '/tmp/fake_audio.wav',
    });
    assert.equal(config.chromiumProfile, CHROMIUM_PROFILES.RECORDING);
    assert.ok(args.some((arg) => arg.includes('fake-video')));
    assert.ok(args.some((arg) => arg.includes('fake-audio')));
    assert.equal(args.includes('--disable-gpu'), false);
    assert.equal(args.includes('--single-process'), false);
  });

  it('uses slim chat-only flags and omits fake media', () => {
    const config = loadConfig({ MODE: 'chat-only' });
    const args = buildLaunchArgs(config, {
      videoPath: '/tmp/fake_video.y4m',
      audioPath: '/tmp/fake_audio.wav',
    });
    assert.equal(config.chromiumProfile, CHROMIUM_PROFILES.CHAT_SLIM);
    assert.equal(args.some((arg) => arg.includes('fake-video')), false);
    assert.ok(args.includes('--disable-gpu'));
    assert.ok(args.includes('--renderer-process-limit=1'));
    assert.ok(args.includes('--no-zygote'));
    assert.ok(args.includes('--mute-audio'));
    assert.equal(args.includes('--single-process'), false);
  });

  it('supports chat-legacy and single-process opt-in', () => {
    const legacy = buildLaunchArgs(loadConfig({ MODE: 'chat-only', CHROMIUM_PROFILE: 'chat-legacy' }), {});
    assert.equal(legacy.includes('--disable-gpu'), false);

    const single = buildLaunchArgs(loadConfig({
      MODE: 'chat-only',
      CHROMIUM_PROFILE: 'chat-single-process',
    }), {});
    assert.ok(single.includes('--single-process'));
  });

  it('documents every emitted flag', () => {
    const config = loadConfig({ MODE: 'chat-only' });
    const args = buildLaunchArgs(config, {});
    const docs = documentFlags(args);
    assert.equal(docs.length, args.length);
    for (const entry of docs) {
      assert.ok(entry.reason.length > 10, `missing doc for ${entry.flag}`);
    }
    assert.ok(CHROMIUM_FLAG_DOCS['--no-sandbox']);
    assert.ok(CHROMIUM_FLAG_DOCS['--single-process']);
  });
});
