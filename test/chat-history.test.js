import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import puppeteer from 'puppeteer';
import { pruneChatHistory, readRecentChatMessages } from '../lib/chat-history.js';
import { installMediaSuppression } from '../lib/media-suppress.js';
import { openChatPanel, sendChatMessage } from '../lib/meet-chat.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-meet-chat.html');

describe('chat history and media suppress', () => {
  it('bounds chat history and still sends on the mock page', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`file://${fixturePath}`);
      await openChatPanel(page, { timeoutMs: 3000 });
      const before = await readRecentChatMessages(page, { limit: 50 });
      assert.equal(before.length, 8);

      const pruned = await pruneChatHistory(page, { limit: 3 });
      assert.equal(pruned.removed, 5);
      const after = await readRecentChatMessages(page, { limit: 20 });
      assert.deepEqual(after, ['seed-6', 'seed-7', 'seed-8']);

      await sendChatMessage(page, 'bounded-hello');
      const last = await page.evaluate(() => window.__lastMessage);
      assert.equal(last, 'bounded-hello');
    } finally {
      await browser.close();
    }
  });

  it('denies getUserMedia after media suppression', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await installMediaSuppression(page);
      await page.goto(`file://${fixturePath}`);
      const denied = await page.evaluate(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          return false;
        } catch (error) {
          return error.name === 'NotAllowedError';
        }
      });
      assert.equal(denied, true);
    } finally {
      await browser.close();
    }
  });
});
