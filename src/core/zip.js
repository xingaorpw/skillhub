/**
 * Minimal ZIP reader (stored + deflate), enough for GitHub's `codeload` archives.
 *
 * Why not a dependency? The CLI must run on a fresh machine with nothing but
 * Node — `npm i` is exactly the step that fails on locked-down corporate
 * laptops, which is the machine this project is for. `zlib.inflateRawSync` is
 * in core, so the whole reader is ~90 lines.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * @typedef {{ name: string, method: number, compSize: number, size: number, offset: number }} ZipEntry
 */

/**
 * @param {Buffer} buffer
 * @returns {ZipEntry[]}
 */
export function listZipEntries(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  /** @type {ZipEntry[]} */
  const entries = [];

  let p = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(p) !== CEN_SIG) throw new Error('corrupt zip: bad central directory entry');
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const offset = buffer.readUInt32LE(p + 42);
    const encoding = flags & 0x800 ? 'utf8' : 'latin1';
    const name = buffer.toString(encoding, p + 46, p + 46 + nameLen);

    entries.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Extract every file entry into `outDir`. Rejects entries that would escape it.
 *
 * @param {Buffer} buffer
 * @param {string} outDir
 * @returns {{ files: number, bytes: number }}
 */
export function extractZip(buffer, outDir) {
  const root = path.resolve(outDir);
  fs.mkdirSync(root, { recursive: true });

  let files = 0;
  let bytes = 0;

  for (const entry of listZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue; // directory marker

    const dest = path.resolve(root, ...entry.name.split('/'));
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`refusing zip entry outside the target directory: ${entry.name}`);
    }

    const local = entry.offset;
    if (buffer.readUInt32LE(local) !== LOC_SIG) throw new Error(`corrupt zip: bad local header for ${entry.name}`);
    const nameLen = buffer.readUInt16LE(local + 26);
    const extraLen = buffer.readUInt16LE(local + 28);
    const start = local + 30 + nameLen + extraLen;
    const raw = buffer.subarray(start, start + entry.compSize);

    const data = entry.method === 0 ? raw : entry.method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    files += 1;
    bytes += data.length;
  }

  return { files, bytes };
}

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
