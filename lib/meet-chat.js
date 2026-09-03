import {
  CHAT_INPUT_KEYWORDS,
  CHAT_INPUT_SELECTORS,
  CHAT_SEND_KEYWORDS,
  CHAT_SEND_SELECTORS,
  CHAT_TOGGLE_KEYWORDS,
  CHAT_TOGGLE_SELECTORS,
  CHAT_TOGGLE_WEAK_KEYWORDS,
  LEAVE_CALL_KEYWORDS,
  MORE_OPTIONS_KEYWORDS,
} from './meet-selectors.js';
import { findFirstVisible } from './chat-selectors.js';
import { inspectMeetState } from './meet-state.js';
import { pruneChatHistory, readRecentChatMessages } from './chat-history.js';

async function clickByKeywords(page, keywords, { weak = [] } = {}) {
  return page.evaluate(
    ({ strong, weakKeywords }) => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 2 && rect.height > 2
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const haystack = (el) => normalize([
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('title'),
        el.textContent,
      ].join(' '));
      const nodes = [...document.querySelectorAll('button, [role="button"], [aria-label]')];
      const tryClick = (list) => {
        for (const el of nodes) {
          if (!visible(el) || el.disabled) continue;
          const text = haystack(el);
          if (list.some((keyword) => text.includes(keyword))) {
            el.click();
            return text.slice(0, 80);
          }
        }
        return null;
      };
      return tryClick(strong) || tryClick(weakKeywords);
    },
    { strong: keywords, weakKeywords: weak },
  );
}

async function findOfficialChatInput(page) {
  return page.evaluate(
    ({ selectors, keywords }) => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node && visible(node)) return selector;
      }
      const fields = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
      for (const el of fields) {
        if (!visible(el)) continue;
        const text = normalize([el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('aria-description')].join(' '));
        if (keywords.some((keyword) => text.includes(keyword))) {
          el.setAttribute('data-bot-chat-input', '1');
          return '[data-bot-chat-input="1"]';
        }
      }
      return null;
    },
    { selectors: CHAT_INPUT_SELECTORS, keywords: CHAT_INPUT_KEYWORDS },
  );
}

async function waitForOfficialChatInput(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const selector = await findOfficialChatInput(page);
    if (selector) return selector;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function openChatPanel(page, { timeoutMs }) {
  const already = await findOfficialChatInput(page);
  if (already) {
    console.log('[chat] Official Meet chat input already visible.');
    return already;
  }

  const attempts = [];

  const viaCss = await page.evaluate((selectors) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2 && !el.disabled;
    };
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (visible(node)) {
          node.click();
          return selector;
        }
      }
    }
    return null;
  }, CHAT_TOGGLE_SELECTORS);
  if (viaCss) {
    attempts.push(`css:${viaCss}`);
    const input = await waitForOfficialChatInput(page, Math.min(4000, timeoutMs));
    if (input) {
      console.log('[chat] Opened official chat via', viaCss);
      return input;
    }
  }

  const viaKeywords = await clickByKeywords(page, CHAT_TOGGLE_KEYWORDS, { weak: CHAT_TOGGLE_WEAK_KEYWORDS });
  if (viaKeywords) {
    attempts.push(`keyword:${viaKeywords}`);
    const input = await waitForOfficialChatInput(page, Math.min(4000, timeoutMs));
    if (input) {
      console.log('[chat] Opened official chat via keyword toggle:', viaKeywords);
      return input;
    }
  }

  const more = await clickByKeywords(page, MORE_OPTIONS_KEYWORDS);
  if (more) {
    attempts.push(`more:${more}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const nested = await clickByKeywords(page, CHAT_TOGGLE_KEYWORDS, { weak: CHAT_TOGGLE_WEAK_KEYWORDS });
    if (nested) {
      attempts.push(`menu:${nested}`);
      const input = await waitForOfficialChatInput(page, Math.min(4000, timeoutMs));
      if (input) {
        console.log('[chat] Opened official chat via More options →', nested);
        return input;
      }
    }
  }

  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyC');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  attempts.push('shortcut:Ctrl+Alt+C');
  const viaShortcut = await waitForOfficialChatInput(page, Math.min(3000, timeoutMs));
  if (viaShortcut) {
    console.log('[chat] Opened official chat via Ctrl+Alt+C');
    return viaShortcut;
  }

  const state = await inspectMeetState(page);
  throw new Error(
    'Could not open the official Meet chat panel (in-call messages). '
      + `Tried: ${attempts.join(', ') || 'no matching controls'}. `
      + `phase=${state.phase} leave=${state.hasLeaveCall} labels=${state.labels.slice(0, 8).join(' | ')}. `
      + 'Use a larger window (1280x720), stay headful, and confirm the room is open.',
  );
}

export async function sendChatMessage(page, message) {
  const inputSelector = await findOfficialChatInput(page);
  if (!inputSelector) {
    throw new Error('Could not locate official Meet chat input. Open chat first.');
  }

  await page.focus(inputSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(message, { delay: 0 });

  const sentVia = await page.evaluate(
    ({ sendSelectors, sendKeywords, inputSelectors }) => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && !el.disabled;
      };
      const haystack = (el) => normalize([el.getAttribute('aria-label'), el.textContent].join(' '));
      for (const selector of sendSelectors) {
        for (const node of document.querySelectorAll(selector)) {
          if (visible(node)) {
            node.click();
            return `button:${selector}`;
          }
        }
      }
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        if (visible(el) && sendKeywords.some((keyword) => haystack(el).includes(keyword))) {
          el.click();
          return `keyword:${haystack(el).slice(0, 40)}`;
        }
      }
      const input = document.querySelector(inputSelectors[0]) || document.querySelector('[data-bot-chat-input="1"]');
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return 'enter';
      }
      return null;
    },
    {
      sendSelectors: CHAT_SEND_SELECTORS,
      sendKeywords: CHAT_SEND_KEYWORDS,
      inputSelectors: CHAT_INPUT_SELECTORS,
    },
  );

  if (!sentVia) {
    await page.keyboard.press('Enter');
    console.log('[chat] Sent message via keyboard Enter');
    return;
  }

  console.log('[chat] Sent message via', sentVia);
}

export async function leaveCall(page) {
  const leftVia = await page.evaluate((keywords) => {
    const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };
    const haystack = (el) => normalize([el.getAttribute('aria-label'), el.textContent].join(' '));
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(el)) continue;
      const text = haystack(el);
      if (keywords.some((keyword) => text.includes(keyword))) {
        el.click();
        return text.slice(0, 80);
      }
    }
    return null;
  }, LEAVE_CALL_KEYWORDS);

  if (leftVia) {
    console.log('[chat] Left call via', leftVia);
  } else {
    console.log('[chat] Leave button not found; closing browser only.');
  }
}

export async function readAndBoundChat(page, { limit = 20 } = {}) {
  const pruned = await pruneChatHistory(page, { limit });
  const messages = await readRecentChatMessages(page, { limit });
  return { pruned, messages };
}

export function probeChatSelectors(documentRoot) {
  return {
    chatToggle: findFirstVisible(documentRoot, CHAT_TOGGLE_SELECTORS)?.selector ?? null,
    chatInput: findFirstVisible(documentRoot, CHAT_INPUT_SELECTORS)?.selector ?? null,
    chatSend: findFirstVisible(documentRoot, CHAT_SEND_SELECTORS)?.selector ?? null,
    leaveCall: findFirstVisible(documentRoot, LEAVE_CALL_SELECTORS)?.selector ?? null,
  };
}
