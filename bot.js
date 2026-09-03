import { runBot } from './lib/run-bot.js';
import { loadLocalEnv } from './lib/load-env.js';

loadLocalEnv();

runBot().catch((err) => {
  console.error('[bot] Exiting with error:', err.message);
  process.exitCode = 1;
});
