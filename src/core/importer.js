/**
 * Importing a skill that the user dropped on the console (or piped in).
 *
 * The browser gives us a flat list of `{ path, bytes }` pairs; this module
 * rebuilds the tree in a temp directory and then reuses the same install path as
 * `skillhub add`, so dropped folders and cloned repositories behave identically.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installFromDir } from './hub.js';
import { discoverSkillDirs } from './installer.js';

/**
 * Reject traversal and absolute paths before touching the filesystem.
 *
 * @param {string} filename
 * @returns {string}
 */
export function safeRelativePath(filename) {
  const normalized = String(filename ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length) throw new Error('uploaded file has no path');
  for (const segment of segments) {
    if (segment === '..') throw new Error(`unsafe upload path: ${filename}`);
    if (segment.includes(':')) throw new Error(`unsafe upload path: ${filename}`);
  }
  return segments.join('/');
}

/**
 * @param {{ path: string, data: Buffer }[]} files
 * @param {string} hubDir
 * @param {{ overwrite?: boolean }} [options]
 * @returns {{ installed: { name: string, action: string }[], skills: string[] }}
 */
export function importFiles(files, hubDir, options = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('nothing to import');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-drop-'));
  const root = path.resolve(work);

  try {
    for (const file of files) {
      const relative = safeRelativePath(file.path);
      const dest = path.resolve(root, ...relative.split('/'));
      if (dest !== root && !dest.startsWith(root + path.sep)) {
        throw new Error(`refusing to write outside the import directory: ${file.path}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.data);
    }

    const dirs = discoverSkillDirs(root);
    if (dirs.length === 0) throw new Error('没有找到 SKILL.md —— 拖进来的文件夹需要包含一个 SKILL.md');

    const installed = [];
    for (const dir of dirs) {
      installed.push(installFromDir(dir, hubDir, { overwrite: Boolean(options.overwrite) }));
    }
    return { installed, skills: installed.map((item) => item.name) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
