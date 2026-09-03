import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { runSimulatedChatOnlyFleet } from '../lib/sim/chat-only-simulator.js';

const DEFAULT_COUNTS = [5, 25, 100, 500, 1000];
const MAX_BOTS = 1000;
const MAX_PEAK_RSS_MB = Number(process.env.LOADTEST_MAX_RSS_MB || 512);
const RECORD_SECONDS = Number(process.env.LOADTEST_RECORD_SECONDS || 2);
const CHAT_INTERVAL_MS = Number(process.env.LOADTEST_CHAT_INTERVAL_MS || 1000);

function parseCounts(argv) {
  const flag = argv.find((arg) => arg.startsWith('--counts='));
  if (!flag) {
    return DEFAULT_COUNTS;
  }
  return flag
    .slice('--counts='.length)
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function readRssKb(pid = process.pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function readProcessStats() {
  const rssKb = readRssKb();
  const cpu = process.cpuUsage();
  return {
    rssKb,
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
  };
}

async function sampleDuring(runFn, sampleIntervalMs = 50) {
  const rssSamples = [];
  const startedAt = performance.now();
  const startStats = readProcessStats();

  const interval = setInterval(() => {
    const rssKb = readRssKb();
    if (rssKb) {
      rssSamples.push(rssKb);
    }
  }, sampleIntervalMs);

  let runResult;
  let runError;
  try {
    runResult = await runFn();
  } catch (error) {
    runError = error;
  } finally {
    clearInterval(interval);
  }

  const endStats = readProcessStats();
  const durationMs = Math.round(performance.now() - startedAt);

  return {
    runResult,
    runError,
    durationMs,
    peakRssKb: rssSamples.length ? Math.max(...rssSamples) : endStats.rssKb,
    avgRssKb: rssSamples.length
      ? Math.round(rssSamples.reduce((sum, value) => sum + value, 0) / rssSamples.length)
      : endStats.rssKb,
    rssSamples: rssSamples.length,
    cpuUserMs: Math.round(endStats.cpuUserMs - startStats.cpuUserMs),
    cpuSystemMs: Math.round(endStats.cpuSystemMs - startStats.cpuSystemMs),
  };
}

function evaluateLimits(botCount, peakRssKb) {
  if (botCount > MAX_BOTS) {
    return {
      status: 'skipped',
      note: `Bot count ${botCount} exceeds hard limit MAX_BOTS=${MAX_BOTS}.`,
    };
  }

  const peakRssMb = peakRssKb ? peakRssKb / 1024 : null;
  if (peakRssMb && peakRssMb > MAX_PEAK_RSS_MB) {
    return {
      status: 'limited',
      note: `Peak RSS ${peakRssMb.toFixed(1)} MB exceeded LOADTEST_MAX_RSS_MB=${MAX_PEAK_RSS_MB}.`,
    };
  }

  return { status: 'ok', note: 'Within local simulation limits.' };
}

async function runScale(botCount) {
  const sampled = await sampleDuring(() =>
    runSimulatedChatOnlyFleet({
      botCount,
      recordSeconds: RECORD_SECONDS,
      chatIntervalMs: CHAT_INTERVAL_MS,
    }),
  );

  const limit = evaluateLimits(botCount, sampled.peakRssKb);
  const throughput =
    sampled.durationMs > 0
      ? Number((sampled.runResult.totalMessages / (sampled.durationMs / 1000)).toFixed(2))
      : 0;

  return {
    botCount,
    status: sampled.runError ? 'failed' : limit.status,
    error: sampled.runError?.message ?? null,
    note: limit.note,
    durationMs: sampled.durationMs,
    totalMessages: sampled.runResult?.totalMessages ?? 0,
    expectedMessagesPerBot: sampled.runResult?.expectedMessagesPerBot ?? 0,
    uniqueBotNames: sampled.runResult?.uniqueBotNames ?? 0,
    pendingTimers: sampled.runResult?.pendingTimers ?? null,
    throughputMsgPerSec: throughput,
    peakRssKb: sampled.peakRssKb,
    avgRssKb: sampled.avgRssKb,
    peakRssMb: sampled.peakRssKb ? Number((sampled.peakRssKb / 1024).toFixed(2)) : null,
    cpuUserMs: sampled.cpuUserMs,
    cpuSystemMs: sampled.cpuSystemMs,
    cpuTotalMs: sampled.cpuUserMs + sampled.cpuSystemMs,
    limits: {
      maxBots: MAX_BOTS,
      maxPeakRssMb: MAX_PEAK_RSS_MB,
      noNetwork: true,
      noBrowser: true,
      simMeetUrl: 'https://meet.example.invalid/local-sim-only',
    },
  };
}

async function main() {
  const counts = parseCounts(process.argv.slice(2));
  const host = {
    platform: os.platform(),
    cpus: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
  };

  console.log('[loadtest] CHAT_ONLY in-process simulation (no Meet, no browser, no network).');
  console.log('[loadtest] Host:', JSON.stringify(host));
  console.log('[loadtest] Session:', {
    recordSeconds: RECORD_SECONDS,
    chatIntervalMs: CHAT_INTERVAL_MS,
    counts,
  });

  const results = [];
  for (const botCount of counts) {
    console.log(`[loadtest] Running scale=${botCount}...`);
    const result = await runScale(botCount);
    results.push(result);
    console.log(
      `[loadtest] scale=${botCount} status=${result.status} msgs=${result.totalMessages} `
        + `throughput=${result.throughputMsgPerSec}/s peakRSS=${result.peakRssMb}MB cpu=${result.cpuTotalMs}ms`,
    );
    if (result.status === 'limited') {
      console.log(`[loadtest] Stopping at scale=${botCount}: ${result.note}`);
      break;
    }
    if (result.status === 'failed') {
      console.error(`[loadtest] Failed at scale=${botCount}: ${result.error}`);
      process.exitCode = 1;
      break;
    }
  }

  const summary = {
    host,
    session: {
      recordSeconds: RECORD_SECONDS,
      chatIntervalMs: CHAT_INTERVAL_MS,
    },
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[loadtest] Fatal:', error.message);
  process.exitCode = 1;
});
