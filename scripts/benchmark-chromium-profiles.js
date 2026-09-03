import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { loadConfig } from '../lib/config.js';
import { buildLaunchArgs } from '../lib/browser.js';
import { acquirePage } from '../lib/page-setup.js';
import { openChatPanel, sendChatMessage } from '../lib/meet-chat.js';
import { createConcurrencyLimiter } from '../lib/startup-gate.js';

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

function readPssKb(pid) {
  try {
    const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const match = rollup.match(/^Pss:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) : null;
  } catch {
    return readRssKb(pid);
  }
}

function listProcPids() {
  return fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number);
}

function readPpid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const match = status.match(/^PPid:\s+(\d+)/m);
  return match ? Number(match[1]) : null;
}

export function collectProcessTree(rootPid) {
  const childrenByParent = new Map();
  for (const pid of listProcPids()) {
    try {
      const ppid = readPpid(pid);
      if (!childrenByParent.has(ppid)) {
        childrenByParent.set(ppid, []);
      }
      childrenByParent.get(ppid).push(pid);
    } catch {
      // process vanished
    }
  }

  const tree = [];
  const walk = (pid) => {
    tree.push(pid);
    for (const child of childrenByParent.get(pid) || []) {
      walk(child);
    }
  };
  walk(rootPid);
  return tree;
}

export function measureTree(rootPid) {
  const pids = collectProcessTree(rootPid);
  let rssKb = 0;
  let pssKb = 0;
  let peakSingleRssKb = 0;
  for (const pid of pids) {
    const rss = readRssKb(pid) || 0;
    const pss = readPssKb(pid) || 0;
    rssKb += rss;
    pssKb += pss;
    peakSingleRssKb = Math.max(peakSingleRssKb, rss);
  }
  return { processCount: pids.length, treeRssKb: rssKb, treePssKb: pssKb, peakSingleRssKb, pids };
}

async function launchProfileSession({ profile, botName, holdMs }) {
  const config = loadConfig({
    MODE: 'chat-only',
    CHROMIUM_PROFILE: profile,
    HEADLESS: 'true',
    BOT_NAME: botName,
    STARTUP_STAGGER_MS: '0',
    STARTUP_JITTER_MS: '0',
    WINDOW_SIZE: profile === 'chat-legacy' ? '1280x720' : '800x600',
  });
  const args = buildLaunchArgs(config, {
    videoPath: path.join(root, 'media/fake_video.y4m'),
    audioPath: path.join(root, 'media/fake_audio.wav'),
  });

  const started = performance.now();
  const cpuStart = process.cpuUsage();
  const browser = await puppeteer.launch({
    headless: true,
    args,
    defaultViewport: { width: config.window.width, height: config.window.height, deviceScaleFactor: 1 },
  });
  const page = await acquirePage(browser, config);
  await page.goto(`file://${fixturePath}`, { waitUntil: config.navigationWaitUntil });
  await openChatPanel(page, { timeoutMs: 3000 });
  await sendChatMessage(page, 'bench');
  const launchMs = Math.round(performance.now() - started);

  const chromePid = browser.process()?.pid;
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  const tree = chromePid
    ? measureTree(chromePid)
    : { processCount: null, treeRssKb: null, treePssKb: null, peakSingleRssKb: null };
  const cpu = process.cpuUsage(cpuStart);

  return {
    browser,
    launchMs,
    processCount: tree.processCount,
    treeRssKb: tree.treeRssKb,
    treePssKb: tree.treePssKb,
    treeRssMb: tree.treeRssKb ? Number((tree.treeRssKb / 1024).toFixed(2)) : null,
    treePssMb: tree.treePssKb ? Number((tree.treePssKb / 1024).toFixed(2)) : null,
    peakSingleRssMb: tree.peakSingleRssKb ? Number((tree.peakSingleRssKb / 1024).toFixed(2)) : null,
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
  };
}

async function measureProfile(profile, { instances, concurrency, staggerMs, holdMs }) {
  const limiter = createConcurrencyLimiter(concurrency);
  const sessions = [];
  const wallStart = performance.now();

  await Promise.all(Array.from({ length: instances }, (_, index) =>
    limiter(async () => {
      if (index > 0 && staggerMs > 0 && index >= concurrency) {
        const wave = Math.floor(index / concurrency);
        await new Promise((resolve) => setTimeout(resolve, wave * 0));
      }
      const session = await launchProfileSession({
        profile,
        botName: `Bench-${profile}-${index + 1}`,
        holdMs,
      });
      sessions.push(session);
    }),
  ));

  const wallMs = Math.round(performance.now() - wallStart);
  const totals = sessions.reduce(
    (acc, session) => {
      acc.processCount += session.processCount || 0;
      acc.treeRssKb += session.treeRssKb || 0;
      acc.treePssKb += session.treePssKb || 0;
      acc.peakSingleRssMb = Math.max(acc.peakSingleRssMb, session.peakSingleRssMb || 0);
      acc.launchMs.push(session.launchMs);
      acc.cpuUserMs += session.cpuUserMs;
      acc.cpuSystemMs += session.cpuSystemMs;
      return acc;
    },
    { processCount: 0, treeRssKb: 0, treePssKb: 0, peakSingleRssMb: 0, launchMs: [], cpuUserMs: 0, cpuSystemMs: 0 },
  );

  for (const session of sessions) {
    await session.browser.close().catch(() => {});
  }

  return {
    profile,
    instances,
    concurrency,
    staggerMs,
    wallMs,
    avgLaunchMs: Math.round(totals.launchMs.reduce((a, b) => a + b, 0) / totals.launchMs.length),
    maxLaunchMs: Math.max(...totals.launchMs),
    processCount: totals.processCount,
    processesPerBot: Number((totals.processCount / instances).toFixed(2)),
    treeRssMb: Number((totals.treeRssKb / 1024).toFixed(2)),
    treePssMb: Number((totals.treePssKb / 1024).toFixed(2)),
    pssPerBotMb: Number((totals.treePssKb / 1024 / instances).toFixed(2)),
    rssPerBotMb: Number((totals.treeRssKb / 1024 / instances).toFixed(2)),
    peakSingleRssMb: totals.peakSingleRssMb,
    cpuUserMs: totals.cpuUserMs,
    cpuSystemMs: totals.cpuSystemMs,
    cpuTotalMs: totals.cpuUserMs + totals.cpuSystemMs,
  };
}

function estimateFor25(sample) {
  const scale = 25 / sample.instances;
  const pssMb = sample.treePssMb ?? sample.treeRssMb;
  return {
    fromInstances: sample.instances,
    profile: sample.profile,
    estimatedProcessCount: Math.round(sample.processCount * scale),
    estimatedPssGiB: Number(((pssMb * scale) / 1024).toFixed(2)),
    estimatedRssGiBOvercount: Number(((sample.treeRssMb * scale) / 1024).toFixed(2)),
    estimatedPssPerBotMb: sample.pssPerBotMb ?? sample.rssPerBotMb,
    note: 'PSS is the fair multi-process estimate. Live Meet decode/UI will add more than this mock page.',
  };
}

async function main() {
  const holdMs = Number(process.env.BENCH_HOLD_MS || 1500);
  const profiles = (process.env.BENCH_PROFILES || 'chat-legacy,chat-slim,chat-single-process')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  console.log('[bench] Local Chromium profile comparison (file:// mock, no Google Meet).');
  const single = [];
  for (const profile of profiles) {
    console.log(`[bench] profile=${profile} instances=1`);
    try {
      single.push(await measureProfile(profile, {
        instances: 1,
        concurrency: 1,
        staggerMs: 0,
        holdMs,
      }));
    } catch (error) {
      single.push({ profile, instances: 1, status: 'failed', error: error.message });
      console.error(`[bench] ${profile} failed:`, error.message);
    }
  }

  const viable = single.filter((row) => !row.error);
  const winner = [...viable].sort((a, b) => {
    if (a.profile === 'chat-single-process') return 1;
    if (b.profile === 'chat-single-process') return -1;
    const pssDelta = (a.treePssMb ?? a.treeRssMb) - (b.treePssMb ?? b.treeRssMb);
    if (Math.abs(pssDelta) > 8) return pssDelta;
    return a.processCount - b.processCount;
  })[0];

  const scales = [];
  if (winner) {
    for (const instances of [1, 3, 5]) {
      console.log(`[bench] winner=${winner.profile} instances=${instances} concurrency=2`);
      scales.push(await measureProfile(winner.profile, {
        instances,
        concurrency: Math.min(2, instances),
        staggerMs: 400,
        holdMs,
      }));
    }
  }

  let startupCompare = null;
  if (winner) {
    console.log(`[bench] startup compare ${winner.profile} x5 simultaneous vs staggered`);
    const simultaneous = await measureProfile(winner.profile, {
      instances: 5,
      concurrency: 5,
      staggerMs: 0,
      holdMs,
    });
    const staggered = await measureProfile(winner.profile, {
      instances: 5,
      concurrency: 2,
      staggerMs: 800,
      holdMs,
    });
    startupCompare = { simultaneous, staggered };
  }

  const report = {
    single,
    winner: winner?.profile ?? null,
    scales,
    startupCompare,
    estimate25: scales.at(-1) ? estimateFor25(scales.at(-1)) : null,
  };
  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error('[bench] Fatal:', error.message);
    process.exitCode = 1;
  });
}
