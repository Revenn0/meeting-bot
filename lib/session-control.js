import fs from 'node:fs';

export function readSessionControl(filePath) {
  if (!filePath) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSessionControl(filePath, state) {
  if (!filePath) return;
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function shouldSkipChatTick(control = {}) {
  return Boolean(control.paused || control.stop);
}
