import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureHub, listSkills } from '../src/core/hub.js';
import { importFiles, safeRelativePath } from '../src/core/importer.js';

function tempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-import-'));
  const hub = path.join(dir, 'hub');
  ensureHub(hub);
  return hub;
}

/**
 * @param {string} name
 * @param {string} [description]
 */
function skillFile(name, description = `${name} skill`) {
  return Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, 'utf8');
}

test('safeRelativePath normalises separators', () => {
  assert.equal(safeRelativePath('a\\b\\SKILL.md'), 'a/b/SKILL.md');
  assert.equal(safeRelativePath('/abs/path.md'), 'abs/path.md');
  assert.equal(safeRelativePath('./a/b.md'), 'a/b.md');
});

test('safeRelativePath refuses traversal and drive letters', () => {
  assert.throws(() => safeRelativePath('../evil.md'), /unsafe/);
  assert.throws(() => safeRelativePath('a/../../evil.md'), /unsafe/);
  assert.throws(() => safeRelativePath('C:/Windows/evil.md'), /unsafe/);
  assert.throws(() => safeRelativePath(''), /no path/);
});

test('imports a dropped folder with its extra files', () => {
  const hub = tempHub();
  const result = importFiles(
    [
      { path: 'my-skill/SKILL.md', data: skillFile('my-skill') },
      { path: 'my-skill/reference.md', data: Buffer.from('# ref', 'utf8') },
      { path: 'my-skill/scripts/run.sh', data: Buffer.from('echo hi', 'utf8') },
    ],
    hub,
  );

  assert.equal(result.installed.length, 1);
  assert.equal(result.installed[0].name, 'my-skill');
  assert.equal(result.installed[0].action, 'added');
  assert.equal(fs.existsSync(path.join(hub, 'my-skill', 'reference.md')), true);
  assert.equal(fs.existsSync(path.join(hub, 'my-skill', 'scripts', 'run.sh')), true);
});

test('imports every skill found in a nested upload', () => {
  const hub = tempHub();
  const result = importFiles(
    [
      { path: 'repo/skills/alpha/SKILL.md', data: skillFile('alpha') },
      { path: 'repo/skills/beta/SKILL.md', data: skillFile('beta') },
    ],
    hub,
  );

  assert.deepEqual(result.skills.sort(), ['alpha', 'beta']);
  assert.equal(listSkills(hub).length, 2);
});

test('a second import skips unless overwrite is set', () => {
  const hub = tempHub();
  const files = [{ path: 'alpha/SKILL.md', data: skillFile('alpha', 'first') }];

  assert.equal(importFiles(files, hub).installed[0].action, 'added');

  const skipped = importFiles(files, hub);
  assert.equal(skipped.installed[0].action, 'skipped');

  const updated = importFiles(
    [{ path: 'alpha/SKILL.md', data: skillFile('alpha', 'second') }],
    hub,
    { overwrite: true },
  );
  assert.equal(updated.installed[0].action, 'updated');

  const description = listSkills(hub)[0].description;
  assert.equal(description, 'second');
});

test('refuses an upload without SKILL.md', () => {
  const hub = tempHub();
  assert.throws(
    () => importFiles([{ path: 'loose/readme.md', data: Buffer.from('nope') }], hub),
    /SKILL\.md/,
  );
});

test('refuses an empty upload', () => {
  const hub = tempHub();
  assert.throws(() => importFiles([], hub), /nothing to import/);
});

test('a traversal attempt leaves the hub untouched', () => {
  const hub = tempHub();
  assert.throws(
    () =>
      importFiles(
        [
          { path: 'ok/SKILL.md', data: skillFile('ok') },
          { path: '../escape.md', data: Buffer.from('bad') },
        ],
        hub,
      ),
    /unsafe/,
  );
  assert.equal(fs.existsSync(path.join(hub, 'ok')), false);
});
