import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, normalizeMode, MODES, isChatOnlyMode } from '../lib/config.js';

describe('config', () => {
  it('defaults to recording mode', () => {
    const config = loadConfig({});
    assert.equal(config.mode, MODES.DEFAULT);
    assert.equal(isChatOnlyMode(config), false);
  });

  it('parses chat-only mode variants', () => {
    assert.equal(normalizeMode('chat-only'), MODES.CHAT_ONLY);
    assert.equal(normalizeMode('CHAT_ONLY'), MODES.CHAT_ONLY);
    assert.equal(normalizeMode('chatonly'), MODES.CHAT_ONLY);
  });

  it('rejects unknown mode', () => {
    assert.throws(() => normalizeMode('live-stream'), /Unknown MODE/);
  });

  it('preserves existing env contract', () => {
    const config = loadConfig({
      MEET_URL: 'https://meet.google.com/abc-defg-hij',
      BOT_NAME: 'Test Bot',
      RECORD_SECONDS: '30',
      HEADLESS: 'true',
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium',
    });

    assert.equal(config.meetUrl, 'https://meet.google.com/abc-defg-hij');
    assert.equal(config.botName, 'Test Bot');
    assert.equal(config.recordSeconds, 30);
    assert.equal(config.headless, true);
    assert.equal(config.puppeteerExecutablePath, '/usr/bin/chromium');
  });

  it('loads chat-only settings with safe defaults', () => {
    const config = loadConfig({ MODE: 'chat-only' });
    assert.equal(config.mode, MODES.CHAT_ONLY);
    assert.equal(config.chatMessage, 'Hello');
    assert.equal(config.chatIntervalMs, 5000);
  });

  it('validates chat-only constraints', () => {
    assert.throws(
      () => loadConfig({ MODE: 'chat-only', CHAT_MESSAGE: '', CHAT_INTERVAL_MS: '500' }),
      /CHAT_MESSAGE must not be empty/,
    );
    assert.throws(
      () => loadConfig({ MODE: 'chat-only', CHAT_INTERVAL_MS: '250' }),
      /CHAT_INTERVAL_MS must be at least 1000/,
    );
  });
});
