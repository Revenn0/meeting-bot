import { createMessageScheduler } from '../message-scheduler.js';
import { joinMeetAsGuest } from '../meet-join.js';
import { leaveCall, openChatPanel, readAndBoundChat, sendChatMessage } from '../meet-chat.js';
import { waitUntilInCall } from '../meet-state.js';
import { logBotResult } from '../bot-result.js';

export async function runChatOnlyMode({ page, config }) {
  console.log('[chat-only] Official Meet chat only (not an overlay).');
  console.log('[chat-only] Message:', JSON.stringify(config.chatMessage));
  console.log('[chat-only] Interval:', config.chatIntervalMs, 'ms');
  console.log('[chat-only] Session duration:', config.recordSeconds, 's');
  console.log('[chat-only] Chromium profile:', config.chromiumProfile);

  await joinMeetAsGuest(page, {
    meetUrl: config.meetUrl,
    botName: config.botName,
    joinTimeoutMs: config.joinTimeoutMs,
    outputDir: config.outputDir,
    waitUntil: config.navigationWaitUntil,
  });

  await waitUntilInCall(page, {
    timeoutMs: config.admitWaitMs,
    outputDir: config.outputDir,
  });

  console.log('[chat-only] In-call confirmed. Staying for RECORD_SECONDS even if official chat fails.');

  let sentCount = 0;
  let lastRead = [];
  let chatOk = false;
  const durationMs = config.recordSeconds * 1000;
  const stayUntil = Date.now() + durationMs;

  try {
    await openChatPanel(page, { timeoutMs: config.chatPanelTimeoutMs });
    chatOk = true;

    const scheduler = createMessageScheduler({
      intervalMs: config.chatIntervalMs,
      durationMs,
      initialDelayMs: Math.min(config.chatIntervalMs, 2000),
      onSend: async () => {
        const { messages } = await readAndBoundChat(page, { limit: config.chatHistoryLimit });
        lastRead = messages;
        await sendChatMessage(page, config.chatMessage);
        sentCount += 1;
        console.log('[chat-only] Messages sent:', sentCount, 'recent visible:', messages.length);
      },
    });

    const controller = scheduler.start();
    await new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, stayUntil - Date.now()));
    });
    controller.stop();
    console.log('[chat-only] Finished sending messages. Total sent:', sentCount);
    if (lastRead.length) {
      console.log('[chat-only] Last bounded chat snapshot size:', lastRead.length);
    }
  } catch (error) {
    console.error('[chat-only] Official chat failed; remaining in-call until timeout:', error.message);
    const remaining = stayUntil - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, remaining);
      });
    }
  }

  logBotResult({
    inCall: true,
    chat: chatOk,
    sent: sentCount,
    botName: config.botName,
  });

  await leaveCall(page);
  console.log('[chat-only] Session complete.');
}
