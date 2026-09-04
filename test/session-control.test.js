import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  readSessionControl,
  shouldSkipChatTick,
  writeSessionControl,
} from '../lib/session-control.js';
import { parseBotStatusLine, parseChatSentLine } from '../lib/bot-result.js';

describe('session control and status lines', () => {
  it('skips chat ticks when paused', () => {
    const file = path.join(os.tmpdir(), `plateia-ctl-${Date.now()}.json`);
    writeSessionControl(file, { paused: true });
    assert.equal(shouldSkipChatTick(readSessionControl(file)), true);
    writeSessionControl(file, { paused: false, stop: true });
    assert.equal(shouldSkipChatTick(readSessionControl(file)), true);
    fs.unlinkSync(file);
  });

  it('parses chatting status from bot stdout', () => {
    const status = parseBotStatusLine('[Plateia-1] [bot-status] {"status":"chatting","sent":2}');
    assert.equal(status.status, 'chatting');
    assert.equal(status.sent, 2);
    assert.equal(parseChatSentLine('[chat-only] Messages sent: 4 recent visible: 1').sent, 4);
  });
});
