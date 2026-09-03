import { installChatHistoryBound } from './chat-history.js';
import { installMediaSuppression } from './media-suppress.js';
import { isChatOnlyMode } from './config.js';

export async function acquirePage(browser, config) {
  const existing = await browser.pages();
  const page = existing[0] || await browser.newPage();

  for (const extra of existing.slice(1)) {
    await extra.close().catch(() => {});
  }

  await page.setViewport({
    width: config.window.width,
    height: config.window.height,
    deviceScaleFactor: 1,
  });

  if (config.debugBrowserLogs) {
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        console.log('[browser]', msg.text());
      }
    });
  }

  if (isChatOnlyMode(config)) {
    await installMediaSuppression(page);
    await installChatHistoryBound(page, { limit: config.chatHistoryLimit });
    await page.setRequestInterception(false);
  }

  return page;
}

export async function applyMeetPermissions(browser, config) {
  const context = browser.defaultBrowserContext();
  if (isChatOnlyMode(config)) {
    await context.clearPermissionOverrides?.().catch(() => {});
    await context.overridePermissions('https://meet.google.com', []);
    console.log('[bot] Chat-only: camera/microphone permissions not granted.');
    return;
  }
  await context.overridePermissions('https://meet.google.com', ['camera', 'microphone']);
}
