import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyChildExit, parseBotJoinLine } from './bot-result.js';

export function guestUserDataDir(name, tmpDir = os.tmpdir()) {
  const safe = String(name || 'guest').replace(/[^\w.-]+/g, '_');
  const dir = path.join(tmpDir, 'meet-bot-profiles', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveFleetChildEntry({ mock = false, childEntry, defaultEntry = 'bot.js' } = {}) {
  if (mock && childEntry) return childEntry;
  return defaultEntry;
}

export function spawnLiveGuest({
  name,
  botIndex,
  meetUrl,
  root,
  childEntry = 'bot.js',
  extraEnv = {},
  onLog,
}) {
  const child = spawn(process.execPath, [childEntry], {
    cwd: root,
    env: {
      ...process.env,
      MODE: 'chat-only',
      MEET_URL: meetUrl,
      BOT_NAME: name,
      BOT_INDEX: String(botIndex),
      WINDOW_SIZE: process.env.WINDOW_SIZE || '1280x720',
      HEADLESS: process.env.HEADLESS || 'false',
      USER_DATA_DIR: process.env.USER_DATA_DIR || guestUserDataDir(name),
      STARTUP_STAGGER_MS: '0',
      STARTUP_JITTER_MS: '0',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${name}] `;
  let joinSettled = false;
  let resolveJoin;
  const joinPromise = new Promise((resolve) => {
    resolveJoin = resolve;
  });

  const settleJoin = (status, extra = {}) => {
    if (joinSettled) return;
    joinSettled = true;
    resolveJoin({ name, botIndex, status, ...extra });
  };

  const handleChunk = (chunk, dest) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line) continue;
      dest.write(`${prefix}${line}\n`);
      onLog?.(`${prefix}${line}`);
      const parsed = parseBotJoinLine(line);
      if (parsed) settleJoin(parsed.status, { payload: parsed });
    }
  };

  child.stdout.on('data', (chunk) => handleChunk(chunk, process.stdout));
  child.stderr.on('data', (chunk) => handleChunk(chunk, process.stderr));

  const exitPromise = new Promise((resolve) => {
    child.on('close', (code) => {
      const status = classifyChildExit(code ?? 1);
      settleJoin(status, { code: code ?? 1, exitedBeforeJoin: true });
      resolve({
        name,
        botIndex,
        code: code ?? 1,
        status,
      });
    });
  });

  return {
    child,
    name,
    botIndex,
    joinPromise,
    exitPromise,
  };
}
