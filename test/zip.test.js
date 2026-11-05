import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractZip, listZipEntries } from '../src/core/zip.js';
import { buildZip } from './helpers/zip.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-zip-'));

test('lists and extracts stored entries', () => {
  const zip = buildZip([
    { name: 'repo-main/SKILL.md', content: '---\nname: demo\n---\n\nhello\n' },
    { name: 'repo-main/extra/notes.txt', content: 'notes' },
  ]);

  const entries = listZipEntries(zip);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['repo-main/SKILL.md', 'repo-main/extra/notes.txt'],
  );

  const out = tmp();
  const result = extractZip(zip, out);
  assert.equal(result.files, 2);
  assert.match(fs.readFileSync(path.join(out, 'repo-main', 'SKILL.md'), 'utf8'), /hello/);
  assert.equal(fs.readFileSync(path.join(out, 'repo-main', 'extra', 'notes.txt'), 'utf8'), 'notes');
});

test('extracts deflated entries', () => {
  const content = 'x'.repeat(5000);
  const zip = buildZip([{ name: 'a.txt', content, deflate: true }]);
  const out = tmp();
  extractZip(zip, out);
  assert.equal(fs.readFileSync(path.join(out, 'a.txt'), 'utf8'), content);
});

test('refuses entries that escape the target directory', () => {
  const zip = buildZip([{ name: '../../evil.txt', content: 'nope' }]);
  assert.throws(() => extractZip(zip, tmp()), /outside the target directory/);
});

test('rejects non-zip input', () => {
  assert.throws(() => listZipEntries(Buffer.from('not a zip at all')), /not a zip/);
});

test('skips directory markers', () => {
  const zip = buildZip([
    { name: 'dir/', content: '' },
    { name: 'dir/file.txt', content: 'ok' },
  ]);
  const out = tmp();
  const result = extractZip(zip, out);
  assert.equal(result.files, 1);
  assert.equal(fs.readFileSync(path.join(out, 'dir', 'file.txt'), 'utf8'), 'ok');
});
