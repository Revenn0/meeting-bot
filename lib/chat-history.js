export const CHAT_MESSAGE_SELECTORS = [
  '[data-message-text]',
  '[data-sender-name]',
  '[aria-live="polite"] [data-message-id]',
  '.chat-message',
  '[data-chat-message]',
];

export async function pruneChatHistory(page, { limit = 20 } = {}) {
  return page.evaluate(
    ({ selectors, maxKeep }) => {
      const nodes = [];
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node) => nodes.push(node));
        if (nodes.length) break;
      }
      const extra = nodes.length - maxKeep;
      if (extra <= 0) {
        return { kept: nodes.length, removed: 0 };
      }
      nodes.slice(0, extra).forEach((node) => node.remove());
      return { kept: maxKeep, removed: extra };
    },
    { selectors: CHAT_MESSAGE_SELECTORS, maxKeep: limit },
  );
}

export async function readRecentChatMessages(page, { limit = 20 } = {}) {
  return page.evaluate(
    ({ selectors, maxKeep }) => {
      const nodes = [];
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node) => nodes.push(node));
        if (nodes.length) break;
      }
      return nodes.slice(-maxKeep).map((node) => (node.textContent || '').trim()).filter(Boolean);
    },
    { selectors: CHAT_MESSAGE_SELECTORS, maxKeep: limit },
  );
}

export async function installChatHistoryBound(page, { limit = 20 } = {}) {
  await page.evaluateOnNewDocument(
    ({ selectors, maxKeep }) => {
      const bind = () => {
        if (window.__chatHistoryBound) return;
        window.__chatHistoryBound = true;
        const prune = () => {
          const nodes = [];
          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((node) => nodes.push(node));
            if (nodes.length) break;
          }
          const extra = nodes.length - maxKeep;
          if (extra > 0) {
            nodes.slice(0, extra).forEach((node) => node.remove());
          }
        };
        const observer = new MutationObserver(() => prune());
        observer.observe(document.documentElement, { childList: true, subtree: true });
        prune();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
      } else {
        bind();
      }
    },
    { selectors: CHAT_MESSAGE_SELECTORS, maxKeep: limit },
  );
}
