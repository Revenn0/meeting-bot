import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const zipName = 'plateia-console-windows.zip';
const zipPath = path.join(distDir, zipName);

const skip = new Set([
  '.git',
  'node_modules',
  'user-data',
  'dist',
  'output',
  'media',
  'bot-profile',
]);

function shouldSkip(rel) {
  const parts = rel.split(path.sep);
  if (parts.some((part) => skip.has(part))) return true;
  if (rel === '.env') return true;
  return false;
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? path.join(prefix, name) : name;
    if (shouldSkip(rel)) continue;
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) out.push(...listFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const files = listFiles(root);
const staging = path.join(distDir, 'plateia-console');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
for (const rel of files) {
  const dest = path.join(staging, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
}
fs.writeFileSync(
  path.join(staging, 'LER-ME-WINDOWS.txt'),
  [
    'PLATEIA CONSOLE',
    '',
    '1. Instala Node.js 20 LTS em https://nodejs.org',
    '2. Duplo clique em INSTALAR.bat',
    '3. Duplo clique em ABRIR.bat',
    '4. Abre http://127.0.0.1:8787 se o browser nao abrir sozinho',
    '',
    'Le INSTALAR.md para o resto.',
    '',
  ].join('\r\n'),
);

function zipStaging() {
  const zipCmd = spawnSync('zip', ['-r', zipPath, 'plateia-console'], { cwd: distDir, encoding: 'utf8' });
  if (zipCmd.status === 0) return 'zip';
  const py = spawnSync('python3', ['-m', 'zipfile', '-c', zipPath, 'plateia-console'], {
    cwd: distDir,
    encoding: 'utf8',
  });
  if (py.status === 0) return 'python';
  throw new Error(`Could not create zip. zip: ${zipCmd.stderr} python: ${py.stderr}`);
}

const tool = zipStaging();
fs.rmSync(staging, { recursive: true, force: true });
console.log(`[pack] ${zipPath} via ${tool} (${files.length} files)`);
