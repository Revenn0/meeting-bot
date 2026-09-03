import {
  CHAT_INPUT_SELECTORS,
  CHAT_SEND_SELECTORS,
  CHAT_TOGGLE_SELECTORS,
  LEAVE_CALL_SELECTORS,
  clickFirstMatch,
  findFirstVisible,
} from './chat-selectors.js';

export async function openChatPanel(page, { timeoutMs }) {
  const opened = await page.evaluate((selectors) => {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const rect = node.getBoundingClientRect?.();
        const visible = rect ? rect.width > 0 && rect.height > 0 : true;
        if (visible && !node.disabled) {
          node.click();
          return selector;
        }
      }
    }
    return null;
  }, CHAT_TOGGLE_SELECTORS);

  if (!opened) {
    throw new Error(
      'Could not open Meet chat panel. Chat toggle selectors may be outdated.',
    );
  }

  console.log('[chat] Opened chat panel via', opened);

  await page.waitForFunction(
    (inputSelectors) => {
      for (const selector of inputSelectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const rect = node.getBoundingClientRect?.();
        const visible = rect ? rect.width > 0 && rect.height > 0 : true;
        if (visible) return true;
      }
      return false;
    },
    { timeout: timeoutMs },
    CHAT_INPUT_SELECTORS,
  ).catch(() => {
    throw new Error(
      'Meet chat input did not appear after opening chat. Chat UI selectors may have changed.',
    );
  });
}

export async function sendChatMessage(page, message) {
  const inputSelector = await page.evaluate((inputSelectors) => {
    for (const selector of inputSelectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const rect = node.getBoundingClientRect?.();
      const visible = rect ? rect.width > 0 && rect.height > 0 : true;
      if (visible) return selector;
    }
    return null;
  }, CHAT_INPUT_SELECTORS);

  if (!inputSelector) {
    throw new Error('Could not locate Meet chat input. Chat UI selectors may have changed.');
  }

  await page.focus(inputSelector);
  await page.keyboard.type(message, { delay: 15 });

  const sentVia = await page.evaluate(
    ({ inputSelectors, sendSelectors }) => {
      const send = () => {
        for (const selector of sendSelectors) {
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            const rect = node.getBoundingClientRect?.();
            const visible = rect ? rect.width > 0 && rect.height > 0 : true;
            if (visible && !node.disabled) {
              node.click();
              return `button:${selector}`;
            }
          }
        }
        return null;
      };

      const buttonResult = send();
      if (buttonResult) return buttonResult;

      for (const selector of inputSelectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        node.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return `enter:${selector}`;
      }
      return null;
    },
    { inputSelectors: CHAT_INPUT_SELECTORS, sendSelectors: CHAT_SEND_SELECTORS },
  );

  if (!sentVia) {
    throw new Error('Could not send chat message via button or Enter key.');
  }

  console.log('[chat] Sent message via', sentVia);
}

export async function leaveCall(page) {
  const leftVia = await page.evaluate((selectors) => {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const rect = node.getBoundingClientRect?.();
        const visible = rect ? rect.width > 0 && rect.height > 0 : true;
        if (visible && !node.disabled) {
          node.click();
          return selector;
        }
      }
    }
    return null;
  }, LEAVE_CALL_SELECTORS);

  if (leftVia) {
    console.log('[chat] Left call via', leftVia);
  } else {
    console.log('[chat] Leave button not found; closing browser only.');
  }
}

export function probeChatSelectors(documentRoot) {
  return {
    chatToggle: findFirstVisible(documentRoot, CHAT_TOGGLE_SELECTORS)?.selector ?? null,
    chatInput: findFirstVisible(documentRoot, CHAT_INPUT_SELECTORS)?.selector ?? null,
    chatSend: findFirstVisible(documentRoot, CHAT_SEND_SELECTORS)?.selector ?? null,
    leaveCall: findFirstVisible(documentRoot, LEAVE_CALL_SELECTORS)?.selector ?? null,
  };
}
