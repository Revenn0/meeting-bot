import { normalizeChromiumProfile, parseWindowSize, CHROMIUM_PROFILES } from './chromium-flags.js';
import { resolveChatMessages, MAX_CHAT_MESSAGE_LENGTH } from './chat-messages.js';

export const MODES = {
  DEFAULT: 'default',
  CHAT_ONLY: 'chat-only',
};

export { CHROMIUM_PROFILES };

const DEFAULT_CHAT_MESSAGE = 'Hello';
const DEFAULT_CHAT_INTERVAL_MS = 5000;
const DEFAULT_RECORD_SECONDS = 15;
const MIN_CHAT_INTERVAL_MS = 1000;

export function normalizeMode(raw) {
  const value = (raw ?? 'default').trim().toLowerCase();
  if (value === '' || value === 'default' || value === 'recording') {
    return MODES.DEFAULT;
  }
  if (value === 'chat-only' || value === 'chat_only' || value === 'chatonly') {
    return MODES.CHAT_ONLY;
  }
  throw new Error(`Unknown MODE="${raw}". Use "default" or "chat-only".`);
}

export function parsePositiveInt(raw, fallback, label) {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer, got "${raw}".`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const mode = normalizeMode(env.MODE);
  const chatOnly = mode === MODES.CHAT_ONLY;

  const meetUrl = env.MEET_URL || 'https://meet.google.com/YOUR-MEET-CODE';
  const botName = env.BOT_NAME || 'Brian Gu';
  const recordSeconds = parsePositiveInt(env.RECORD_SECONDS, DEFAULT_RECORD_SECONDS, 'RECORD_SECONDS');
  const headless = env.HEADLESS === 'true';
  const puppeteerExecutablePath = env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const chatMessages = resolveChatMessages({
    chatMessage: env.CHAT_MESSAGE ?? DEFAULT_CHAT_MESSAGE,
    chatMessagesJson: env.CHAT_MESSAGES_JSON,
  });
  const chatMessage = (chatMessages[0] || (env.CHAT_MESSAGE ?? DEFAULT_CHAT_MESSAGE)).trim();
  const chatIntervalMs = parsePositiveInt(
    env.CHAT_INTERVAL_MS,
    DEFAULT_CHAT_INTERVAL_MS,
    'CHAT_INTERVAL_MS',
  );

  if (chatOnly) {
    if (!chatMessage && !chatMessages.length) {
      throw new Error('CHAT_MESSAGE must not be empty in chat-only mode.');
    }
    if (chatMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(
        `CHAT_MESSAGE exceeds ${MAX_CHAT_MESSAGE_LENGTH} characters (${chatMessage.length}).`,
      );
    }
    if (chatIntervalMs < MIN_CHAT_INTERVAL_MS) {
      throw new Error(
        `CHAT_INTERVAL_MS must be at least ${MIN_CHAT_INTERVAL_MS} ms (got ${chatIntervalMs}).`,
      );
    }
  }

  const chromiumProfile = normalizeChromiumProfile(env.CHROMIUM_PROFILE, { chatOnly });
  const windowFallback = chatOnly ? '800x600' : '1280x720';
  const window = parseWindowSize(env.WINDOW_SIZE, windowFallback);

  return {
    mode,
    meetUrl,
    botName,
    recordSeconds,
    headless,
    puppeteerExecutablePath,
    chatMessage,
    chatMessages: chatMessages.length ? chatMessages : (chatMessage ? [chatMessage] : []),
    chatIntervalMs,
    chatHistoryLimit: parsePositiveInt(env.CHAT_HISTORY_LIMIT, 20, 'CHAT_HISTORY_LIMIT') || 20,
    joinTimeoutMs: parsePositiveInt(env.JOIN_TIMEOUT_MS, 30000, 'JOIN_TIMEOUT_MS'),
    admitWaitMs: parsePositiveInt(env.ADMIT_WAIT_MS, 20000, 'ADMIT_WAIT_MS'),
    chatPanelTimeoutMs: parsePositiveInt(env.CHAT_PANEL_TIMEOUT_MS, 20000, 'CHAT_PANEL_TIMEOUT_MS'),
    chromiumProfile,
    window,
    jsHeapMb: parsePositiveInt(env.JS_HEAP_MB, 96, 'JS_HEAP_MB') || 96,
    botIndex: parsePositiveInt(env.BOT_INDEX, 0, 'BOT_INDEX'),
    startupStaggerMs: parsePositiveInt(env.STARTUP_STAGGER_MS, 2500, 'STARTUP_STAGGER_MS'),
    startupConcurrency: parsePositiveInt(env.STARTUP_CONCURRENCY, 2, 'STARTUP_CONCURRENCY') || 2,
    startupJitterMs: parsePositiveInt(env.STARTUP_JITTER_MS, 250, 'STARTUP_JITTER_MS'),
    debugBrowserLogs: env.DEBUG_BROWSER_LOGS === 'true',
    userDataDir: env.USER_DATA_DIR || undefined,
    sessionControlFile: env.SESSION_CONTROL_FILE || '',
    navigationWaitUntil: chatOnly ? (env.NAV_WAIT_UNTIL || 'domcontentloaded') : 'networkidle2',
    paths: {
      video: env.VIDEO_PATH,
      audio: env.AUDIO_PATH,
      outputDir: env.OUTPUT_DIR,
    },
  };
}

export function isChatOnlyMode(config) {
  return config.mode === MODES.CHAT_ONLY;
}
