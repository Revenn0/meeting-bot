import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvFile } from '../lib/load-env.js';

const SETTINGS_NAME = 'settings.json';
const ENV_NAME = '.env';

export function defaultUserDataDir(root, env = process.env) {
  if (env.PLATEIA_USER_DATA) {
    return path.resolve(env.PLATEIA_USER_DATA);
  }
  if (root) {
    return path.join(root, 'user-data');
  }
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PlateiaConsole');
  }
  return path.join(os.homedir(), '.plateia-console');
}

export function emptySettings() {
  return {
    onboardingComplete: false,
    openrouterApiKey: '',
    model: '',
    lastMeetUrl: '',
    lastBotCount: 6,
    lastBrief: '',
    lastTone: 'curioso',
    extraPhrases: '',
    botNamePrefix: 'Plateia',
    recordSeconds: 180,
    chatIntervalMs: 8000,
    showChrome: true,
    lastModels: [],
    lastModelsAt: 0,
  };
}

export function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '········';
  return `${value.slice(0, 6)}···${value.slice(-4)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readKeyFromEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  return parsed.OPENROUTER_API_KEY || parsed.PLATEIA_OPENROUTER_KEY || '';
}

export function writeEnvFile(filePath, key) {
  const lines = [
    '# Plateia Console — gerado localmente. NÃO commitar.',
    `OPENROUTER_API_KEY=${key}`,
    '',
  ];
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

export function createSettingsStore({ root, userDataDir, env = process.env } = {}) {
  const dir = userDataDir || defaultUserDataDir(root, env);
  const settingsPath = path.join(dir, SETTINGS_NAME);
  const envPath = path.join(dir, ENV_NAME);

  const load = () => {
    ensureDir(dir);
    const stored = readJson(settingsPath) || {};
    const settings = { ...emptySettings(), ...stored };
    const fileKey = readKeyFromEnvFile(envPath);
    if (fileKey) settings.openrouterApiKey = fileKey;
    if (!settings.openrouterApiKey && env.OPENROUTER_API_KEY) {
      settings.openrouterApiKey = env.OPENROUTER_API_KEY;
    }
    return settings;
  };

  const save = (patch = {}) => {
    const current = load();
    const next = { ...current, ...patch };
    const key = String(next.openrouterApiKey || '').trim();
    next.openrouterApiKey = key;
    ensureDir(dir);
    writeEnvFile(envPath, key);
    const disk = { ...next };
    delete disk.openrouterApiKey;
    fs.writeFileSync(settingsPath, `${JSON.stringify(disk, null, 2)}\n`, 'utf8');
    return next;
  };

  const publicView = (settings = load()) => ({
    onboardingComplete: Boolean(settings.onboardingComplete),
    hasKey: Boolean(settings.openrouterApiKey),
    keyHint: maskKey(settings.openrouterApiKey),
    model: settings.model || '',
    lastMeetUrl: settings.lastMeetUrl || '',
    lastBotCount: settings.lastBotCount,
    lastBrief: settings.lastBrief || '',
    lastTone: settings.lastTone || 'curioso',
    extraPhrases: settings.extraPhrases || '',
    botNamePrefix: settings.botNamePrefix || 'Plateia',
    recordSeconds: settings.recordSeconds,
    chatIntervalMs: settings.chatIntervalMs,
    showChrome: settings.showChrome !== false,
    lastModels: settings.lastModels || [],
    lastModelsAt: settings.lastModelsAt || 0,
    userDataDir: dir,
  });

  return {
    dir,
    settingsPath,
    envPath,
    load,
    save,
    publicView,
  };
}
