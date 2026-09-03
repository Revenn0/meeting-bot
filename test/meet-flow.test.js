import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import puppeteer from 'puppeteer';
import { classifyJoinLabel } from '../lib/meet-selectors.js';
import { clickVisibleJoinControl, joinMeetAsGuest } from '../lib/meet-join.js';
import { openChatPanel, sendChatMessage } from '../lib/meet-chat.js';
import { MeetBlockedError } from '../lib/bot-result.js';
import { inspectMeetState, waitUntilInCall } from '../lib/meet-state.js';
import { runChatOnlyMode } from '../lib/modes/chat-only.js';
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

  it('classifies Join now / Entrar above Ask to join', () => {
    assert.equal(classifyJoinLabel('Join now'), 'join-now');
    assert.equal(classifyJoinLabel('Entrar'), 'join-now');
    assert.equal(classifyJoinLabel('Ask to join'), 'ask-to-join');
    assert.equal(classifyJoinLabel('Pedir para participar'), 'ask-to-join');
    assert.equal(classifyJoinLabel('Ask to join now please'), 'ask-to-join');
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
      const before = await inspectMeetState(page);
      assert.equal(before.phase, 'prejoin');
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?delay=80`,
        botName: 'One Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      const after = await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 50 });
      assert.equal(after.phase, 'in-call');
      assert.equal(after.hasLeaveCall, true);
    });
  });
});

describe('join now preference', () => {
  it('clicks visible Join now and ignores hidden Ask to join', async () => {
    await withPage('?variant=hidden-ask&delay=40', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?variant=hidden-ask&delay=40`,
        botName: 'Open Room Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      const clicks = await page.evaluate(() => ({
        join: window.__joinClicks,
        ask: window.__askClicks,
      }));
      assert.equal(clicks.ask, 0);
      assert.ok(clicks.join >= 1);
      const after = await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 40 });
      assert.equal(after.phase, 'in-call');
    });
  });

  it('retries Join now once if the first click leaves the guest on prejoin', async () => {
    await withPage('?variant=sticky-prejoin&delay=40', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?variant=sticky-prejoin&delay=40`,
        botName: 'Retry Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      const clicks = await page.evaluate(() => window.__joinClicks);
      assert.equal(clicks, 2);
      const after = await waitUntilInCall(page, { timeoutMs: 2000, outputDir: '/tmp', pollMs: 40 });
      assert.equal(after.phase, 'in-call');
    });
  });

  it('does not report hidden Ask to join as a clickable control', async () => {
    await withPage('?variant=hidden-ask', async (page) => {
      const probe = await clickVisibleJoinControl(page, { joinNowOnly: true });
      assert.equal(probe.kind, 'join-now');
      assert.equal(probe.ignoredHiddenAsk, true);
      assert.match(probe.clicked, /join now|entrar/i);
    });
  });
});

describe('blocked interstitial', () => {
  it('hard-fails on You can\'t join after Join now', async () => {
    await withPage('?variant=blocked&delay=40', async (page) => {
      await joinMeetAsGuest(page, {
        meetUrl: `file://${fixture}?variant=blocked&delay=40`,
        botName: 'Blocked Bot',
        joinTimeoutMs: 3000,
        outputDir: '/tmp',
        waitUntil: 'domcontentloaded',
      });
      await assert.rejects(
        () => waitUntilInCall(page, { timeoutMs: 1500, outputDir: '/tmp', pollMs: 40 }),
        MeetBlockedError,
      );
    });
  });
});

describe('stay in-call if chat fails', () => {
  it('remains in-call when official chat cannot open', async () => {
    await withPage('?variant=no-chat&delay=40', async (page) => {
      await runChatOnlyMode({
        page,
        config: {
          meetUrl: `file://${fixture}?variant=no-chat&delay=40`,
          botName: 'Stay Bot',
          joinTimeoutMs: 3000,
          admitWaitMs: 2000,
          chatPanelTimeoutMs: 800,
          chatIntervalMs: 1000,
          recordSeconds: 1,
          chatHistoryLimit: 5,
          chatMessage: 'x',
          chromiumProfile: 'chat-slim',
          outputDir: '/tmp',
          navigationWaitUntil: 'domcontentloaded',
        },
      });
      const left = await page.evaluate(() => window.__left === true);
      assert.equal(left, true);
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
