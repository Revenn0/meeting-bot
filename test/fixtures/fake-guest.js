/**
 * Offline stand-in for bot.js. Emits [bot-join] immediately, stays a bit, exits.
 * Used only by FLEET_MOCK tests — never contacts Google Meet.
 */
const status = process.env.FAKE_JOIN_STATUS || 'in-call';
const stayMs = Number.parseInt(process.env.FAKE_STAY_MS || '150', 10);
const name = process.env.BOT_NAME || 'fake';

const exitByStatus = {
  'in-call': 0,
  blocked: 20,
  'not-in-call': 21,
  fatal: 1,
};

process.stdout.write(`[bot-join] ${JSON.stringify({ status, botName: name })}\n`);
await new Promise((resolve) => setTimeout(resolve, Number.isFinite(stayMs) ? stayMs : 150));
process.stdout.write(`[bot-result] ${JSON.stringify({ inCall: status === 'in-call', chat: false, botName: name })}\n`);
process.exit(exitByStatus[status] ?? 1);
