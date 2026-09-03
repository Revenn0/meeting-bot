import { createMessageScheduler } from '../message-scheduler.js';
import { joinMeetAsGuest } from '../meet-join.js';
import { leaveCall, openChatPanel, sendChatMessage } from '../meet-chat.js';

export async function runChatOnlyMode({ page, config }) {
  console.log('[chat-only] Skipping fake media injection and WebRTC capture.');
  console.log('[chat-only] Message:', JSON.stringify(config.chatMessage));
  console.log('[chat-only] Interval:', config.chatIntervalMs, 'ms');
  console.log('[chat-only] Session duration:', config.recordSeconds, 's');

  await joinMeetAsGuest(page, {
    meetUrl: config.meetUrl,
    botName: config.botName,
    joinTimeoutMs: config.joinTimeoutMs,
    outputDir: config.outputDir,
  });

  console.log(`[chat-only] Waiting ${config.admitWaitMs}ms for host admit before opening chat...`);
  await new Promise((resolve) => setTimeout(resolve, config.admitWaitMs));

  await openChatPanel(page, { timeoutMs: config.chatPanelTimeoutMs });

  let sentCount = 0;
  const durationMs = config.recordSeconds * 1000;
  const scheduler = createMessageScheduler({
    intervalMs: config.chatIntervalMs,
    durationMs,
    initialDelayMs: config.chatIntervalMs,
    onSend: async () => {
      await sendChatMessage(page, config.chatMessage);
      sentCount += 1;
      console.log('[chat-only] Messages sent:', sentCount);
    },
  });

  const controller = scheduler.start();

  await new Promise((resolve) => {
    setTimeout(resolve, durationMs + config.chatIntervalMs);
  });

  controller.stop();
  console.log('[chat-only] Finished sending messages. Total sent:', sentCount);

  await leaveCall(page);
  console.log('[chat-only] Session complete.');
}
