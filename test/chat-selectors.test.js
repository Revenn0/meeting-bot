import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import puppeteer from 'puppeteer';
import { buildLaunchArgs } from '../lib/browser.js';
import { loadConfig } from '../lib/config.js';
import { openChatPanel, sendChatMessage } from '../lib/meet-chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'mock-meet-chat.html');

describe('browser launch args', () => {
  it('omits fake media flags in chat-only mode', () => {
    const config = loadConfig({ MODE: 'chat-only' });
    const args = buildLaunchArgs(config, {
      videoPath: '/tmp/fake_video.y4m',
      audioPath: '/tmp/fake_audio.wav',
    });

    assert.equal(args.some((arg) => arg.includes('fake-video')), false);
    assert.equal(args.some((arg) => arg.includes('fake-audio')), false);
  });

  it('keeps fake media flags in default mode', () => {
    const config = loadConfig({});
    const args = buildLaunchArgs(config, {
      videoPath: '/tmp/fake_video.y4m',
      audioPath: '/tmp/fake_audio.wav',
    });

    assert.equal(args.some((arg) => arg.includes('fake-video')), true);
    assert.equal(args.some((arg) => arg.includes('fake-audio')), true);
  });
});

describe('mock meet chat page', () => {
  it('finds selectors and sends a message locally', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.goto(`file://${fixturePath}?phase=in-call`);

      const beforeOpen = await page.evaluate(() => {
        return window.probe?.() ?? null;
      }).catch(() => null);

      assert.equal(beforeOpen, null);

      const probe = await page.evaluate((selectors) => {
        const findFirstVisible = (root, list) => {
          for (const selector of list) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
              const rect = node.getBoundingClientRect?.();
              const visible = rect ? rect.width > 0 && rect.height > 0 : true;
              if (visible && !node.disabled) return selector;
            }
          }
          return null;
        };

        return {
          chatToggle: findFirstVisible(document, selectors.chatToggle),
          leaveCall: findFirstVisible(document, selectors.leaveCall),
        };
      }, {
        chatToggle: [
          'button[aria-label*="Chat with everyone"]',
          'button[aria-label*="Chat"]',
        ],
        leaveCall: ['button[aria-label*="Leave call"]'],
      });

      assert.ok(probe.chatToggle);
      assert.ok(probe.leaveCall);

      await openChatPanel(page, { timeoutMs: 3000 });
      await sendChatMessage(page, 'Mock hello');

      const lastMessage = await page.evaluate(() => window.__lastMessage);
      assert.equal(lastMessage, 'Mock hello');
    } finally {
      await browser.close();
    }
  });

});
