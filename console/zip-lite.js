import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function readU16(buf, offset) {
  return buf.readUInt16LE(offset);
}

function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (readU32(buf, i) === EOCD_SIG) return i;
  }
  throw new Error('ZIP inválido: falta o diretório central.');
}

function safeRelPath(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) {
    throw new Error(`ZIP recusado: caminho inseguro (${name})`);
  }
  return parts.join(path.sep);
}

export function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEocd(buf);
  const count = readU16(buf, eocd + 10);
  let offset = readU32(buf, eocd + 16);
  fs.mkdirSync(destDir, { recursive: true });

  for (let i = 0; i < count; i += 1) {
    if (readU32(buf, offset) !== CENTRAL_SIG) {
      throw new Error('ZIP inválido: entrada central corrompida.');
    }
    const method = readU16(buf, offset + 10);
    const compressed = readU32(buf, offset + 20);
    const nameLen = readU16(buf, offset + 28);
    const extraLen = readU16(buf, offset + 30);
    const commentLen = readU16(buf, offset + 32);
    const localOff = readU32(buf, offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    const rel = safeRelPath(name);
    if (!rel) continue;
    if (readU32(buf, localOff) !== LOCAL_SIG) {
      throw new Error(`ZIP inválido: cabeçalho local em falta (${name})`);
    }
    const localNameLen = readU16(buf, localOff + 26);
    const localExtraLen = readU16(buf, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const packed = buf.subarray(dataStart, dataStart + compressed);
    let data;
    if (method === 0) data = packed;
    else if (method === 8) data = zlib.inflateRawSync(packed);
    else throw new Error(`ZIP: método ${method} não suportado (${name})`);

    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

function dosDateTime(date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

export function createStoreZip(files, zipPath) {
  const { dosTime, dosDate } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = String(file.name).replace(/\\/g, '/');
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data ?? ''), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameBuf, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, eocd]));
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}
