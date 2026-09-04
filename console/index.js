import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlateiaApp } from './app.js';
import { MAX_FLEET_SIZE } from '../lib/wave-planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.PLATEIA_PORT || '8787', 10);
const HOST = process.env.PLATEIA_HOST || '127.0.0.1';

const { app, settingsStore, session } = createPlateiaApp({ root: ROOT });
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`[plateia] Consola pronta em ${url}`);
  console.log(`[plateia] Dados locais: ${settingsStore.dir}`);
  console.log(`[plateia] Teto: ${MAX_FLEET_SIZE} convidados reais no Meet`);
});

export { app, server, settingsStore, session };
