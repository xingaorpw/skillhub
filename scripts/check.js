#!/usr/bin/env node
/**
 * Zero-dependency sanity checks that CI runs before the test suite.
 *
 * It is not a linter — it catches the failure modes that actually break this
 * project: a syntax error in a file nobody imports yet, a missing web asset, a
 * `package.json` whose `bin` does not exist, or a README link that points at a
 * file we forgot to commit.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

/**
 * @param {string} message
 */
function fail(message) {
  failures.push(message);
}

/**
 * @param {string} dir
 * @param {(file: string) => void} visit
 */
function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

// 1. every JavaScript file must parse
/** @type {string[]} */
const jsFiles = [];
for (const dir of ['src', 'test', 'scripts']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  walk(full, (file) => {
    if (file.endsWith('.js') || file.endsWith('.mjs')) jsFiles.push(file);
  });
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`syntax error in ${path.relative(root, file)}\n${result.stderr.trim()}`);
  }
}

// 2. web assets referenced by index.html must exist (skip API routes)
const webRoot = path.join(root, 'web');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const assetRefs = [...indexHtml.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => /\.(css|js|svg|png|woff2?|ico)$/i.test(ref));
for (const ref of assetRefs) {
  const candidate = path.join(webRoot, ref);
  if (!fs.existsSync(candidate)) fail(`web/index.html references missing asset: ${ref}`);
}

// 3. package.json must point at real files
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  if (!fs.existsSync(path.join(root, target))) fail(`package.json bin "${name}" -> missing ${target}`);
}
for (const target of [pkg.main, pkg.exports?.['.']].filter(Boolean)) {
  if (!fs.existsSync(path.join(root, target))) fail(`package.json entry point missing: ${target}`);
}

// 4. README must not link to files that do not exist
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const match of readme.matchAll(/\]\((\.{1,2}\/[^)#]+)(?:#[^)]*)?\)/g)) {
  const target = path.resolve(root, match[1]);
  if (!fs.existsSync(target)) fail(`README links to a missing file: ${match[1]}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(`✓ checked ${jsFiles.length} JavaScript files, ${assetRefs.length} web assets, package metadata and README links`);
