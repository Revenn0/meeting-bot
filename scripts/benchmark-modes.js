import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLaunchArgs } from '../lib/browser.js';
import { loadConfig } from '../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'test/fixtures/mock-meet-chat.html');

function readRssKb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function buildArgsForMode(mode) {
  const config = loadConfig({ MODE: mode, HEADLESS: 'true' });
  return buildLaunchArgs(config, {
    videoPath: path.join(root, 'media/fake_video.y4m'),
    audioPath: path.join(root, 'media/fake_audio.wav'),
  });
}

async function measureMode(mode) {
  const launchArgs = buildArgsForMode(mode);
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-'],
    {
      cwd: root,
      env: process.env,
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );

  child.stdin.write(`
    import puppeteer from 'puppeteer';
    const browser = await puppeteer.launch({
      headless: true,
      args: ${JSON.stringify(launchArgs)},
    });
    const page = await browser.newPage();
    await page.goto('file://${fixturePath}');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await browser.close();
  `);
  child.stdin.end();

  const samples = [];
  const interval = setInterval(() => {
    const rss = readRssKb(child.pid);
    if (rss) samples.push(rss);
  }, 200);

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  clearInterval(interval);

  return {
    mode,
    exitCode,
    peakKb: samples.length ? Math.max(...samples) : null,
    avgKb: samples.length
      ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
      : null,
    samples: samples.length,
  };
}

async function main() {
  console.log('[benchmark] Comparing browser RSS on local mock page (no Google Meet).');
  const results = [];
  for (const mode of ['default', 'chat-only']) {
    results.push(await measureMode(mode));
  }

  console.log(JSON.stringify(results, null, 2));

  const defaultPeak = results.find((entry) => entry.mode === 'default')?.peakKb;
  const chatPeak = results.find((entry) => entry.mode === 'chat-only')?.peakKb;
  if (defaultPeak && chatPeak) {
    const saved = defaultPeak - chatPeak;
    console.log(
      `[benchmark] chat-only peak RSS ~${saved} kB lower than default on this host (${chatPeak} vs ${defaultPeak} kB).`,
    );
  }
}

main().catch((err) => {
  console.error('[benchmark] Failed:', err.message);
  process.exitCode = 1;
});
