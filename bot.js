import { runBot } from './lib/run-bot.js';
import { loadLocalEnv } from './lib/load-env.js';
import { classifyChildExit, exitCodeForError, logBotJoin } from './lib/bot-result.js';

loadLocalEnv();

runBot().catch((err) => {
  console.error('[bot] Exiting with error:', err.message);
  const code = exitCodeForError(err);
  logBotJoin({
    status: classifyChildExit(code),
    reason: err.message,
  });
  process.exitCode = code;
});
