import fs from 'node:fs';
import path from 'node:path';

export function parseEnvFile(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function applyEnvFile(filePath, env = process.env) {
  if (!fs.existsSync(filePath)) {
    return { loaded: false, path: filePath, keys: [] };
  }
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, path: filePath, keys };
}

export function loadLocalEnv(cwd = process.cwd()) {
  return applyEnvFile(path.resolve(cwd, '.env'));
}
