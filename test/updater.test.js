import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, after } from 'node:test';
import { createPlateiaApp } from '../console/app.js';
import { createSettingsStore } from '../console/settings-store.js';
import {
  applyPackageOverlay,
  compareSemver,
  createUpdater,
  isNewerVersion,
  normalizeVersion,
  pickReleaseAsset,
  readLocalVersion,
  resolvePackageRoot,
  sessionBlocksUpdate,
  shouldPreserveRel,
} from '../console/updater.js';
import { createStoreZip, extractZip } from '../console/zip-lite.js';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function bytesResponse(buf, status = 200) {
  return new Response(buf, {
    status,
    headers: { 'content-length': String(buf.length) },
  });
}

describe('semver and assets', () => {
  it('strips a leading v and compares versions', () => {
    assert.equal(normalizeVersion('v2.1.0'), '2.1.0');
    assert.equal(compareSemver('2.1.0', '2.0.0'), 1);
    assert.equal(compareSemver('v2.0.0', '2.0.0'), 0);
    assert.equal(compareSemver('2.0.0', '2.1.0'), -1);
    assert.equal(isNewerVersion('2.1.0', '2.0.0'), true);
    assert.equal(isNewerVersion('2.0.0', '2.0.0'), false);
    assert.equal(isNewerVersion('1.9.9', '2.0.0'), false);
  });

  it('prefers plateia-console-windows.zip then the setup exe', () => {
    const assets = [
      { name: 'notes.txt', browser_download_url: 'https://example.test/notes.txt' },
      { name: 'PlateiaConsole-Setup.exe', browser_download_url: 'https://example.test/setup.exe' },
      { name: 'plateia-console-windows.zip', browser_download_url: 'https://example.test/app.zip' },
    ];
    assert.equal(pickReleaseAsset(assets).name, 'plateia-console-windows.zip');
    assert.equal(pickReleaseAsset(assets.slice(0, 2)).name, 'PlateiaConsole-Setup.exe');
    assert.equal(pickReleaseAsset([]), null);
  });

  it('preserves user-data and .env paths', () => {
    assert.equal(shouldPreserveRel('user-data/settings.json'), true);
    assert.equal(shouldPreserveRel('user-data/.env'), true);
    assert.equal(shouldPreserveRel('.env'), true);
    assert.equal(shouldPreserveRel('console/app.js'), false);
    assert.equal(shouldPreserveRel('package.json'), false);
  });
});

describe('zip overlay', () => {
  it('extracts a store zip and keeps user-data when applying', () => {
    const dir = tmpDir('plateia-zip-');
    const zipPath = path.join(dir, 'pack.zip');
    createStoreZip([
      { name: 'plateia-console/package.json', data: '{"version":"2.1.0"}' },
      { name: 'plateia-console/hello.txt', data: 'novo' },
      { name: 'plateia-console/user-data/settings.json', data: '{"stolen":true}' },
    ], zipPath);

    const extracted = path.join(dir, 'out');
    extractZip(zipPath, extracted);
    const packRoot = resolvePackageRoot(extracted);
    assert.equal(fs.readFileSync(path.join(packRoot, 'hello.txt'), 'utf8'), 'novo');

    const appRoot = path.join(dir, 'app');
    fs.mkdirSync(path.join(appRoot, 'user-data'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'package.json'), '{"version":"2.0.0"}');
    fs.writeFileSync(path.join(appRoot, 'hello.txt'), 'antigo');
    fs.writeFileSync(path.join(appRoot, 'user-data', 'settings.json'), '{"openrouter":"keep"}');
    fs.writeFileSync(path.join(appRoot, 'user-data', '.env'), 'OPENROUTER_API_KEY=secret');

    const result = applyPackageOverlay(packRoot, appRoot);
    assert.equal(fs.readFileSync(path.join(appRoot, 'hello.txt'), 'utf8'), 'novo');
    assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version, '2.1.0');
    assert.equal(fs.readFileSync(path.join(appRoot, 'user-data', 'settings.json'), 'utf8'), '{"openrouter":"keep"}');
    assert.equal(fs.readFileSync(path.join(appRoot, 'user-data', '.env'), 'utf8'), 'OPENROUTER_API_KEY=secret');
    assert.ok(result.copied >= 2);
    assert.ok(result.preserved.some((rel) => rel.includes('user-data')));
  });
});

describe('createUpdater check/start', () => {
  it('reads a newer GitHub Release and applies a mocked zip', async () => {
    const root = tmpDir('plateia-up-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    const store = createSettingsStore({ userDataDir: path.join(root, 'user-data') });
    store.save({ openrouterApiKey: 'sk-keep', model: 'free' });
    const zipPath = path.join(root, 'fixture.zip');
    createStoreZip([
      { name: 'package.json', data: '{"name":"plateia-console","version":"2.1.0"}' },
      { name: 'console/new-file.txt', data: 'ok' },
    ], zipPath);
    const zipBuf = fs.readFileSync(zipPath);
    let installed = false;

    const updater = createUpdater({
      root,
      settingsStore: store,
      session: { phase: 'idle' },
      localVersion: '2.0.0',
      installImpl: async () => {
        installed = true;
      },
      fetchImpl: async (url) => {
        if (String(url).includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v2.1.0',
            name: 'v2.1.0',
            assets: [{
              name: 'plateia-console-windows.zip',
              browser_download_url: 'https://example.test/plateia-console-windows.zip',
            }],
          });
        }
        if (String(url).includes('plateia-console-windows.zip')) {
          return bytesResponse(zipBuf);
        }
        return new Response('nope', { status: 404 });
      },
    });

    const checked = await updater.check();
    assert.equal(checked.available, true);
    assert.equal(checked.skipped, false);
    assert.equal(checked.latestVersion, '2.1.0');
    assert.equal(checked.source, 'release');
    assert.equal(checked.phase, 'ready');

    const applied = await updater.start();
    assert.equal(applied.phase, 'done');
    assert.equal(applied.progress, 100);
    assert.equal(installed, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '2.1.0');
    assert.equal(fs.readFileSync(path.join(root, 'console', 'new-file.txt'), 'utf8'), 'ok');
    assert.equal(store.load().openrouterApiKey, 'sk-keep');
  });

  it('skips the same version once and unblocks a newer one', async () => {
    const root = tmpDir('plateia-skip-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    const store = createSettingsStore({ userDataDir: path.join(root, 'user-data') });
    const release = {
      tag_name: 'v2.1.0',
      assets: [{ name: 'plateia-console-windows.zip', browser_download_url: 'https://example.test/app.zip' }],
    };
    const updater = createUpdater({
      root,
      settingsStore: store,
      localVersion: '2.0.0',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases/latest')) return jsonResponse(release);
        return new Response('nope', { status: 404 });
      },
    });
    await updater.check();
    const skipped = updater.skipCurrent();
    assert.equal(skipped.skipped, true);
    assert.equal(store.load().skippedUpdateVersion, '2.1.0');
    const again = await updater.check();
    assert.equal(again.available, true);
    assert.equal(again.skipped, true);
    assert.equal(again.phase, 'idle');

    release.tag_name = 'v2.2.0';
    const newer = await updater.check();
    assert.equal(newer.latestVersion, '2.2.0');
    assert.equal(newer.skipped, false);
    assert.equal(newer.phase, 'ready');
  });

  it('soft-fails on GitHub rate limits', async () => {
    const root = tmpDir('plateia-rl-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    const updater = createUpdater({
      root,
      settingsStore: createSettingsStore({ userDataDir: path.join(root, 'user-data') }),
      localVersion: '2.0.0',
      fetchImpl: async () => jsonResponse({ message: 'rate' }, 403, { 'x-ratelimit-remaining': '0' }),
    });
    const checked = await updater.check();
    assert.equal(checked.available, false);
    assert.equal(checked.rateLimited, true);
    assert.equal(checked.phase, 'idle');
  });

  it('falls back to the product branch package.json when there is no Release', async () => {
    const root = tmpDir('plateia-fb-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    const updater = createUpdater({
      root,
      settingsStore: createSettingsStore({ userDataDir: path.join(root, 'user-data') }),
      localVersion: '2.0.0',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases/latest')) return new Response('{}', { status: 404 });
        if (String(url).includes('product/plateia-ui-minimal/package.json')) {
          return jsonResponse({ version: '2.1.0' });
        }
        return new Response('nope', { status: 404 });
      },
    });
    const checked = await updater.check();
    assert.equal(checked.available, true);
    assert.equal(checked.source, 'branch');
    assert.equal(checked.latestVersion, '2.1.0');
    assert.match(checked.downloadUrl, /plateia-ui-minimal\.zip$/);
  });

  it('blocks apply while a Meet session is live or paused', async () => {
    const root = tmpDir('plateia-live-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    const store = createSettingsStore({ userDataDir: path.join(root, 'user-data') });
    const updater = createUpdater({
      root,
      settingsStore: store,
      session: { phase: 'live' },
      localVersion: '2.0.0',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v2.1.0',
            assets: [{ name: 'app.zip', browser_download_url: 'https://example.test/app.zip' }],
          });
        }
        return new Response('nope', { status: 404 });
      },
    });
    await updater.check();
    const blocked = await updater.start();
    assert.equal(blocked.phase, 'blocked');
    assert.match(blocked.error, /ensaio ao vivo/);
    assert.equal(sessionBlocksUpdate({ phase: 'paused' }), true);
    assert.equal(sessionBlocksUpdate({ phase: 'idle' }), false);
  });

  it('exposes mocked restart without exiting the test process', () => {
    const root = tmpDir('plateia-rs-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    let called = 0;
    const updater = createUpdater({
      root,
      settingsStore: createSettingsStore({ userDataDir: path.join(root, 'user-data') }),
      localVersion: '2.0.0',
      restartImpl: () => {
        called += 1;
        return { pid: 1 };
      },
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });
    assert.deepEqual(updater.restart(), { pid: 1 });
    assert.equal(called, 1);
    assert.equal(readLocalVersion(root), '2.0.0');
  });
});

describe('update HTTP API', () => {
  const servers = [];

  after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('checks, skips and reports status over HTTP', async () => {
    const root = tmpDir('plateia-http-up-');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
    const settingsStore = createSettingsStore({ userDataDir: path.join(root, 'user-data') });
    const updater = createUpdater({
      root,
      settingsStore,
      session: { phase: 'idle' },
      localVersion: '2.0.0',
      fetchImpl: async (url) => {
        if (String(url).includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v2.1.0',
            assets: [{
              name: 'plateia-console-windows.zip',
              browser_download_url: 'https://example.test/app.zip',
            }],
          });
        }
        return new Response('nope', { status: 404 });
      },
    });
    const { app } = createPlateiaApp({
      root,
      settingsStore,
      session: {
        snapshot: () => ({ phase: 'idle', bots: [], log: [], counters: {} }),
        subscribe: () => () => {},
      },
      openrouter: {
        async listFreeModels() { return []; },
        async complete() { return { text: '', model: '' }; },
        async testConnection() { return { ok: true }; },
      },
      updater,
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.version, '2.0.0');

    const checked = await fetch(`${base}/api/update/check`).then((r) => r.json());
    assert.equal(checked.update.available, true);
    assert.equal(checked.update.latestVersion, '2.1.0');

    const skipped = await fetch(`${base}/api/update/skip`, { method: 'POST' }).then((r) => r.json());
    assert.equal(skipped.update.skipped, true);

    const status = await fetch(`${base}/api/update/status`).then((r) => r.json());
    assert.equal(status.update.skipped, true);
  });
});
