import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractZip } from './zip-lite.js';

export const GITHUB_REPO = 'Revenn0/meeting-bot';
export const PREFERRED_ASSET_NAMES = [
  'plateia-console-windows.zip',
  'PlateiaConsole-Setup.exe',
];
export const FALLBACK_REFS = [
  'product/plateia-ui-minimal',
  'product/plateia-console',
  'main',
];
export const PRESERVE_TOP = new Set([
  'user-data',
  '.git',
  'node_modules',
  'dist',
  'output',
  'media',
  'bot-profile',
]);

const UA = { 'User-Agent': 'PlateiaConsole', Accept: 'application/vnd.github+json' };

export function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

export function compareSemver(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const av = left[i] || 0;
    const bv = right[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function isNewerVersion(remote, local) {
  return compareSemver(remote, local) > 0;
}

export function readLocalVersion(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return '0.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return normalizeVersion(pkg.version);
  } catch {
    return '0.0.0';
  }
}

export function pickReleaseAsset(assets = []) {
  const list = Array.isArray(assets) ? assets : [];
  for (const name of PREFERRED_ASSET_NAMES) {
    const exact = list.find((asset) => asset?.name === name && asset.browser_download_url);
    if (exact) return exact;
  }
  const zip = list.find((asset) => /\.zip$/i.test(asset?.name || '') && /plateia/i.test(asset.name));
  if (zip) return zip;
  const anyZip = list.find((asset) => /\.zip$/i.test(asset?.name || ''));
  if (anyZip) return anyZip;
  const exe = list.find((asset) => /\.exe$/i.test(asset?.name || ''));
  return exe || null;
}

export function resolvePackageRoot(extractedDir) {
  if (fs.existsSync(path.join(extractedDir, 'package.json'))) return extractedDir;
  let entries = [];
  try {
    entries = fs.readdirSync(extractedDir).filter((name) => name !== '__MACOSX');
  } catch {
    return extractedDir;
  }
  if (entries.length === 1) {
    const only = path.join(extractedDir, entries[0]);
    if (fs.statSync(only).isDirectory()) return resolvePackageRoot(only);
  }
  for (const name of entries) {
    const candidate = path.join(extractedDir, name);
    if (fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  return extractedDir;
}

export function shouldPreserveRel(rel) {
  const normalized = String(rel || '').replace(/\\/g, '/');
  if (normalized === '.env' || normalized.startsWith('.env/')) return true;
  const top = normalized.split('/')[0];
  return PRESERVE_TOP.has(top);
}

export function listFilesRecursive(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else out.push(rel);
  }
  return out;
}

export function applyPackageOverlay(sourceRoot, destRoot) {
  const files = listFilesRecursive(sourceRoot);
  let copied = 0;
  for (const rel of files) {
    if (shouldPreserveRel(rel)) continue;
    const dest = path.join(destRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...rel.split('/')), dest);
    copied += 1;
  }
  return { copied, preserved: files.filter((rel) => shouldPreserveRel(rel)) };
}

export function sessionBlocksUpdate(session) {
  const phase = typeof session?.phase === 'string'
    ? session.phase
    : session?.snapshot?.()?.phase;
  return phase === 'live' || phase === 'paused';
}

function jsonHeaders(res) {
  const headers = {};
  if (res.headers && typeof res.headers.get === 'function') {
    headers['x-ratelimit-remaining'] = res.headers.get('x-ratelimit-remaining');
  }
  return headers;
}

function isRateLimited(res) {
  if (res.status === 429) return true;
  if (res.status === 403) return true;
  const remaining = jsonHeaders(res)['x-ratelimit-remaining'];
  return remaining === '0';
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function downloadToFile(url, destPath, { fetchImpl = globalThis.fetch, onProgress } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'PlateiaConsole' } });
  if (!res.ok) throw new Error(`Download falhou (${res.status}).`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const total = Number(res.headers?.get?.('content-length')) || 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      const pct = total ? Math.min(99, Math.round((received / total) * 100)) : Math.min(90, 8 + chunks.length);
      onProgress?.(pct, received, total);
    }
    fs.writeFileSync(destPath, Buffer.concat(chunks));
    onProgress?.(100, received, total);
    return destPath;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  onProgress?.(100, buf.length, buf.length);
  return destPath;
}

export async function runNpmInstall(cwd, { spawnFn = spawn, skip = false } = {}) {
  if (skip) return { skipped: true };
  if (!fs.existsSync(path.join(cwd, 'package-lock.json'))) return { skipped: true };
  await new Promise((resolve, reject) => {
    const child = spawnFn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev'], {
      cwd,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install falhou (código ${code}).`));
    });
  });
  return { skipped: false };
}

export function spawnRestart({
  execPath = process.execPath,
  scriptPath,
  cwd,
  env = process.env,
  delayMs = 700,
  spawnFn = spawn,
  exitFn = (code) => process.exit(code),
} = {}) {
  const child = spawnFn(execPath, [scriptPath], {
    cwd,
    env: { ...env, PLATEIA_RESTARTED: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref?.();
  const timer = setTimeout(() => exitFn(0), delayMs);
  timer.unref?.();
  return { pid: child.pid || 0 };
}

function emptyStatus(currentVersion) {
  return {
    phase: 'idle',
    progress: 0,
    currentVersion,
    latestVersion: null,
    available: false,
    skipped: false,
    source: null,
    assetName: null,
    downloadUrl: null,
    notes: '',
    error: null,
    rateLimited: false,
    restartHint: 'ABRIR.bat',
  };
}

export function createUpdater({
  root,
  settingsStore,
  session,
  fetchImpl = (...args) => globalThis.fetch(...args),
  localVersion,
  repo = GITHUB_REPO,
  fallbackRefs = FALLBACK_REFS,
  extractImpl = extractZip,
  installImpl,
  restartImpl,
  now = () => Date.now(),
} = {}) {
  if (!root) throw new Error('updater: falta root');
  const currentVersion = normalizeVersion(localVersion || readLocalVersion(root));
  const workDir = settingsStore?.dir
    ? path.join(settingsStore.dir, 'updates')
    : path.join(root, 'user-data', 'updates');

  let status = emptyStatus(currentVersion);
  const listeners = new Set();

  const emit = () => {
    const snap = getStatus();
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch {
        // ignore
      }
    }
  };

  const patch = (partial) => {
    status = { ...status, ...partial };
    emit();
    return getStatus();
  };

  function getStatus() {
    return { ...status, currentVersion };
  }

  function skippedVersion() {
    return normalizeVersion(settingsStore?.load?.()?.skippedUpdateVersion || '');
  }

  async function fetchLatestRelease() {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetchImpl(url, { headers: UA });
    if (isRateLimited(res)) {
      return { rateLimited: true };
    }
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error(`GitHub Releases: HTTP ${res.status}`);
    const body = await readJson(res);
    return { release: body };
  }

  async function fallbackFromBranch() {
    for (const ref of fallbackRefs) {
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${ref}/package.json`;
      const res = await fetchImpl(rawUrl, { headers: { 'User-Agent': 'PlateiaConsole' } });
      if (isRateLimited(res)) return { rateLimited: true };
      if (!res.ok) continue;
      const pkg = await readJson(res);
      const version = normalizeVersion(pkg?.version);
      if (!version) continue;
      return {
        version,
        source: 'branch',
        notes: ref,
        downloadUrl: `https://github.com/${repo}/archive/refs/heads/${ref}.zip`,
        assetName: `${ref.replace(/\//g, '-')}.zip`,
      };
    }
    return null;
  }

  async function check({ ignoreSkip = false } = {}) {
    patch({
      phase: 'checking',
      error: null,
      rateLimited: false,
      progress: 0,
    });
    try {
      let latestVersion = null;
      let source = null;
      let assetName = null;
      let downloadUrl = null;
      let notes = '';

      const latest = await fetchLatestRelease();
      if (latest.rateLimited) {
        return patch({
          phase: 'idle',
          available: false,
          rateLimited: true,
          error: null,
        });
      }
      if (latest.release) {
        latestVersion = normalizeVersion(latest.release.tag_name || latest.release.name);
        source = 'release';
        notes = latest.release.name || latest.release.tag_name || '';
        const asset = pickReleaseAsset(latest.release.assets);
        if (asset) {
          assetName = asset.name;
          downloadUrl = asset.browser_download_url;
        } else if (latest.release.zipball_url) {
          assetName = 'source.zip';
          downloadUrl = latest.release.zipball_url;
        }
      } else {
        const fallback = await fallbackFromBranch();
        if (fallback?.rateLimited) {
          return patch({
            phase: 'idle',
            available: false,
            rateLimited: true,
            error: null,
          });
        }
        if (fallback) {
          latestVersion = fallback.version;
          source = fallback.source;
          assetName = fallback.assetName;
          downloadUrl = fallback.downloadUrl;
          notes = fallback.notes;
        }
      }

      const available = Boolean(latestVersion && downloadUrl && isNewerVersion(latestVersion, currentVersion));
      const skipped = Boolean(
        available
        && !ignoreSkip
        && skippedVersion()
        && compareSemver(latestVersion, skippedVersion()) === 0,
      );
      return patch({
        phase: available && !skipped ? 'ready' : 'idle',
        available,
        skipped,
        latestVersion,
        source,
        assetName,
        downloadUrl,
        notes,
        progress: available && !skipped ? 100 : 0,
        error: null,
        rateLimited: false,
      });
    } catch (error) {
      return patch({
        phase: 'idle',
        available: false,
        error: error.message || String(error),
      });
    }
  }

  function skipCurrent() {
    const version = status.latestVersion || '';
    if (version && settingsStore?.save) {
      settingsStore.save({ skippedUpdateVersion: normalizeVersion(version) });
    }
    return patch({
      skipped: true,
      phase: 'idle',
      progress: 0,
    });
  }

  async function start() {
    if (status.phase === 'downloading' || status.phase === 'applying') {
      throw new Error('Já há uma atualização a decorrer.');
    }
    if (sessionBlocksUpdate(session)) {
      return patch({
        phase: 'blocked',
        error: 'Há um ensaio ao vivo ou em pausa. Termina o ensaio antes de atualizar.',
      });
    }
    if (!status.downloadUrl || !status.available) {
      await check({ ignoreSkip: true });
    }
    if (sessionBlocksUpdate(session)) {
      return patch({
        phase: 'blocked',
        error: 'Há um ensaio ao vivo ou em pausa. Termina o ensaio antes de atualizar.',
      });
    }
    if (!status.downloadUrl || !isNewerVersion(status.latestVersion, currentVersion)) {
      throw new Error('Não há atualização para aplicar.');
    }

    const stamp = now();
    const archiveName = status.assetName || 'update.bin';
    const archivePath = path.join(workDir, `${stamp}-${path.basename(archiveName)}`);
    const staging = path.join(workDir, `staging-${stamp}`);

    try {
      patch({ phase: 'downloading', progress: 4, error: null });
      await downloadToFile(status.downloadUrl, archivePath, {
        fetchImpl,
        onProgress: (pct) => patch({ phase: 'downloading', progress: Math.max(4, Math.round(pct * 0.7)) }),
      });

      if (/\.exe$/i.test(archiveName)) {
        if (process.platform !== 'win32') {
          throw new Error('Instalador .exe só corre no Windows. Publica plateia-console-windows.zip no Release.');
        }
        patch({ phase: 'applying', progress: 90 });
        spawn(archivePath, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref?.();
        return patch({
          phase: 'done',
          progress: 100,
          restartHint: 'instalador',
        });
      }

      patch({ phase: 'applying', progress: 74 });
      fs.rmSync(staging, { recursive: true, force: true });
      extractImpl(archivePath, staging);
      const packRoot = resolvePackageRoot(staging);
      applyPackageOverlay(packRoot, root);
      patch({ phase: 'applying', progress: 86 });
      if (installImpl) {
        await installImpl(root);
      } else {
        await runNpmInstall(root);
      }
      fs.rmSync(staging, { recursive: true, force: true });
      try {
        fs.unlinkSync(archivePath);
      } catch {
        // leave the archive if locked
      }
      return patch({
        phase: 'done',
        progress: 100,
        restartHint: 'ABRIR.bat',
      });
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      return patch({
        phase: 'error',
        error: error.message || String(error),
      });
    }
  }

  function restart() {
    if (restartImpl) return restartImpl();
    return spawnRestart({
      scriptPath: path.join(root, 'console', 'index.js'),
      cwd: root,
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    check,
    start,
    skipCurrent,
    restart,
    getStatus,
    subscribe,
    workDir,
    currentVersion,
  };
}
