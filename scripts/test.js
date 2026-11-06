/**
 * Cross-version test runner.
 *
 * `node --test` changed how it interprets arguments:
 *   - Node 18/20 accept a directory and scan it, but do not expand globs.
 *   - Node 22+ expand globs, but treat a bare directory as a module to load.
 *
 * Rather than depend on either behaviour, discover the files here and pass an
 * explicit list — that form works identically on every supported version.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDir = path.join(root, 'test');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function findTests(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findTests(full);
      return entry.name.endsWith('.test.js') ? [full] : [];
    });
}

const files = findTests(testDir).sort();
if (files.length === 0) {
  console.error('no test files found in test/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
