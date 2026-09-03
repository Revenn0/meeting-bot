import { createMessageScheduler } from '../message-scheduler.js';
import { joinMeetAsGuest } from '../meet-join.js';
import { leaveCall, openChatPanel, readAndBoundChat, sendChatMessage } from '../meet-chat.js';

export async function runChatOnlyMode({ page, config }) {
  console.log('[chat-only] Skipping fake media injection and WebRTC capture.');
  console.log('[chat-only] Message:', JSON.stringify(config.chatMessage));
  console.log('[chat-only] Interval:', config.chatIntervalMs, 'ms');
  console.log('[chat-only] Session duration:', config.recordSeconds, 's');
  console.log('[chat-only] Chromium profile:', config.chromiumProfile);
  console.log('[chat-only] Chat history limit:', config.chatHistoryLimit);

  await joinMeetAsGuest(page, {
    meetUrl: config.meetUrl,
    botName: config.botName,
    joinTimeoutMs: config.joinTimeoutMs,
    outputDir: config.outputDir,
    waitUntil: config.navigationWaitUntil,
  });

  console.log(`[chat-only] Waiting ${config.admitWaitMs}ms for host admit before opening chat...`);
  await new Promise((resolve) => setTimeout(resolve, config.admitWaitMs));

  await openChatPanel(page, { timeoutMs: config.chatPanelTimeoutMs });

  let sentCount = 0;
  let lastRead = [];
  const durationMs = config.recordSeconds * 1000;
  const scheduler = createMessageScheduler({
    intervalMs: config.chatIntervalMs,
    durationMs,
    initialDelayMs: config.chatIntervalMs,
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
    setTimeout(resolve, durationMs + config.chatIntervalMs);
  });

  controller.stop();
  console.log('[chat-only] Finished sending messages. Total sent:', sentCount);
  if (lastRead.length) {
    console.log('[chat-only] Last bounded chat snapshot size:', lastRead.length);
  }

  await leaveCall(page);
  console.log('[chat-only] Session complete.');
}
