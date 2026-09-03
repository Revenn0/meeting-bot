import { loadConfig } from '../config.js';
import { createMessageScheduler } from '../message-scheduler.js';

const SIM_MEET_URL = 'https://meet.example.invalid/local-sim-only';

export function createChatOnlyBotSimulator({
  botName = 'SimBot',
  recordSeconds = 2,
  chatIntervalMs = 1000,
  chatMessage = 'load-test',
  setTimer,
  clearTimer,
  onSend,
} = {}) {
  const config = loadConfig({
    MODE: 'chat-only',
    MEET_URL: SIM_MEET_URL,
    BOT_NAME: botName,
    RECORD_SECONDS: String(recordSeconds),
    CHAT_INTERVAL_MS: String(chatIntervalMs),
    CHAT_MESSAGE: chatMessage,
  });

  let sentMessages = 0;
  const durationMs = config.recordSeconds * 1000;
  const scheduler = createMessageScheduler({
    intervalMs: config.chatIntervalMs,
    durationMs,
    initialDelayMs: config.chatIntervalMs,
    setTimer,
    clearTimer,
    onSend: async () => {
      sentMessages += 1;
      if (onSend) {
        await onSend({ config, sentMessages });
      }
    },
  });

  return {
    config,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
    get sentMessages() {
      return sentMessages;
    },
    get pendingTimers() {
      return scheduler.pendingCount;
    },
  };
}

export function createSimulatedBotFleet(botCount, options = {}) {
  return Array.from({ length: botCount }, (_, index) =>
    createChatOnlyBotSimulator({
      botName: `SimBot-${index + 1}`,
      ...options,
    }),
  );
}

export async function runSimulatedChatOnlyFleet({
  botCount,
  recordSeconds = 2,
  chatIntervalMs = 1000,
  settleBufferMs = 100,
}) {
  const bots = createSimulatedBotFleet(botCount, { recordSeconds, chatIntervalMs });
  const durationMs = recordSeconds * 1000;

  for (const bot of bots) {
    bot.start();
  }

  await new Promise((resolve) => {
    setTimeout(resolve, durationMs + chatIntervalMs + settleBufferMs);
  });

  for (const bot of bots) {
    bot.stop();
  }

  const totalMessages = bots.reduce((sum, bot) => sum + bot.sentMessages, 0);
  const expectedMessagesPerBot = Math.floor(durationMs / chatIntervalMs);
  const uniqueNames = new Set(bots.map((bot) => bot.config.botName));

  return {
    botCount,
    totalMessages,
    expectedMessagesPerBot,
    uniqueBotNames: uniqueNames.size,
    pendingTimers: bots.reduce((sum, bot) => sum + bot.pendingTimers, 0),
  };
}
