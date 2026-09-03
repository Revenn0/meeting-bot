import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import puppeteer from 'puppeteer';
import { joinMeetAsGuest } from '../lib/meet-join.js';
import { openChatPanel, sendChatMessage } from '../lib/meet-chat.js';
import { inspectMeetState, waitUntilInCall } from '../lib/meet-state.js';
import { matchesAnyKeyword } from '../lib/meet-selectors.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-meet-chat.html');

async function withPage(query, fn) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${fixture}${query}`);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

describe('meet keywords', () => {
  it('matches official chat and join labels across locales', () => {
    assert.equal(matchesAnyKeyword('Chat with everyone', ['chat with everyone']), true);
    assert.equal(matchesAnyKeyword('Conversar com todos', ['conversar com todos']), true);
    assert.equal(matchesAnyKeyword('Join now', ['join now', 'ask to join']), true);
  });
});

describe('in-call detection', () => {
  it('does not treat pre-join as in-call', async () => {
    await withPage('', async (page) => {
      const state = await inspectMeetState(page);
      assert.equal(state.phase, 'prejoin');
      assert.equal(state.hasLeaveCall, false);
    });
  });

  it('does not treat waiting room as in-call after Join now', async () => {
    await withPage('?variant=waiting&delay=50', async (page) => {
      await page.click('#join-now');
      await new Promise((resolve) => setTimeout(resolve, 80));
      const state = await inspectMeetState(page);
      assert.equal(state.phase, 'waiting');
      await assert.rejects(
        () => waitUntilInCall(page, { timeoutMs: 400, outputDir: '/tmp', pollMs: 50 }),
        /Not in the live Meet call/,
      );
    });
  });

  it('confirms in-call only after Leave call appears', async () => {
    await withPage('?delay=80', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?delay=80`,
        botName: 'One Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      const before = await inspectMeetState(page);
      assert.notEqual(before.phase, 'in-call');
      const after = await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 50 });
      assert.equal(after.phase, 'in-call');
      assert.equal(after.hasLeaveCall, true);
    });
  });
});

describe('official chat open + send', () => {
  it('joins, opens toolbar chat, and sends', async () => {
    await withPage('?delay=40', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?delay=40`,
        botName: 'Chat Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 40 });
      await openChatPanel(page, { timeoutMs: 3000 });
      await sendChatMessage(page, 'official-hello');
      const last = await page.evaluate(() => window.__lastMessage);
      assert.equal(last, 'official-hello');
    });
  });

  it('opens official chat from More options when the toolbar icon is hidden', async () => {
    await withPage('?delay=40&variant=more-menu', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?delay=40&variant=more-menu`,
        botName: 'Menu Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 40 });
      await openChatPanel(page, { timeoutMs: 4000 });
      await sendChatMessage(page, 'from-more-menu');
      const last = await page.evaluate(() => window.__lastMessage);
      assert.equal(last, 'from-more-menu');
    });
  });
});
