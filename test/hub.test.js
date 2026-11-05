import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ensureHub,
  installFromDir,
  listSkills,
  loadConfig,
  readSkill,
  removeSkill,
  resolveSkillDir,
  saveConfig,
  summarize,
} from '../src/core/hub.js';
import { discoverSkillDirs, parseSource, sourceLabel } from '../src/core/installer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.join(__dirname, 'fixtures', 'repo');

function tempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-hub-'));
  return path.join(dir, 'hub');
}

test('ensureHub creates the folder and a config file', () => {
  const hub = tempHub();
  const { created } = ensureHub(hub);
  assert.equal(created, true);
  assert.equal(fs.existsSync(path.join(hub, 'skillhub.json')), true);
  assert.equal(ensureHub(hub).created, false);
});

test('installs every skill from a folder and lists it with parsed metadata', () => {
  const hub = tempHub();
  ensureHub(hub);

  const dirs = discoverSkillDirs(FIXTURE_REPO);
  assert.equal(dirs.length, 2);

  for (const dir of dirs) installFromDir(dir, hub);

  const skills = listSkills(hub);
  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['alpha', 'beta'],
  );

  const alpha = skills.find((skill) => skill.name === 'alpha');
  assert.match(alpha.description, /alpha workflow/);
  assert.equal(alpha.disableModelInvocation, false);
  assert.ok(alpha.catalogTokens > 0);
  assert.ok(alpha.files >= 1);

  const beta = skills.find((skill) => skill.name === 'beta');
  assert.match(beta.description, /^Beta handles the second half of the pipeline\. Use it when alpha/);
  assert.equal(beta.disableModelInvocation, true);
});

test('skips existing skills unless overwrite is requested', () => {
  const hub = tempHub();
  ensureHub(hub);
  const dir = path.join(FIXTURE_REPO, 'skills', 'alpha');

  assert.deepEqual(installFromDir(dir, hub), { name: 'alpha', action: 'added' });
  assert.deepEqual(installFromDir(dir, hub), { name: 'alpha', action: 'skipped' });
  assert.deepEqual(installFromDir(dir, hub, { overwrite: true }), { name: 'alpha', action: 'updated' });
});

test('reads a skill body and refuses path traversal', () => {
  const hub = tempHub();
  ensureHub(hub);
  installFromDir(path.join(FIXTURE_REPO, 'skills', 'alpha'), hub);

  const skill = readSkill(hub, 'alpha');
  assert.match(skill.markdown, /# Alpha/);
  assert.match(skill.path, /alpha$/);

  assert.throws(() => resolveSkillDir(hub, '../etc'), /invalid skill name/);
  assert.throws(() => resolveSkillDir(hub, 'missing'), /no such skill/);
});

test('removes a skill from the hub', () => {
  const hub = tempHub();
  ensureHub(hub);
  installFromDir(path.join(FIXTURE_REPO, 'skills', 'alpha'), hub);
  removeSkill(hub, 'alpha');
  assert.equal(listSkills(hub).length, 0);
});

test('config round-trips the shelf and sources', () => {
  const hub = tempHub();
  ensureHub(hub);
  const config = loadConfig(hub);
  config.shelf = ['alpha'];
  config.sources['owner/repo'] = { source: 'owner/repo', skills: ['alpha'] };
  saveConfig(hub, config);

  const reloaded = loadConfig(hub);
  assert.deepEqual(reloaded.shelf, ['alpha']);
  assert.equal(reloaded.sources['owner/repo'].source, 'owner/repo');
});

test('a BOM in skillhub.json does not wipe the config', () => {
  const hub = tempHub();
  ensureHub(hub);

  const config = {
    version: 1,
    shelf: ['alpha'],
    tools: [{ id: 'demo', label: 'Demo', dir: path.join(hub, 'demo-skills'), create: true }],
    sources: {},
  };
  // PowerShell's Set-Content and Notepad both like to prepend a BOM.
  fs.writeFileSync(path.join(hub, 'skillhub.json'), `\uFEFF${JSON.stringify(config, null, 2)}`, 'utf8');

  const loaded = loadConfig(hub);
  assert.deepEqual(loaded.shelf, ['alpha']);
  assert.equal(loaded.tools.length, 1);
  assert.equal(loaded.tools[0].id, 'demo');
});

test('summarize counts what the model actually pays for', () => {
  const hub = tempHub();
  ensureHub(hub);
  for (const dir of discoverSkillDirs(FIXTURE_REPO)) installFromDir(dir, hub);

  const skills = listSkills(hub);
  const all = summarize(skills, null);
  assert.equal(all.count, 2);
  assert.equal(all.onShelf, 2);
  assert.equal(all.visibleTokens, all.catalogTokens);

  const one = summarize(skills, ['alpha']);
  assert.equal(one.onShelf, 1);
  assert.ok(one.visibleTokens < one.catalogTokens);
});

test('parseSource understands short names, URLs and local paths', () => {
  assert.deepEqual(parseSource('mattpocock/skills'), {
    kind: 'github',
    owner: 'mattpocock',
    repo: 'skills',
    ref: null,
    sub: null,
  });

  assert.deepEqual(parseSource('https://github.com/owner/repo/tree/dev/skills/foo'), {
    kind: 'github',
    owner: 'owner',
    repo: 'repo',
    ref: 'dev',
    sub: 'skills/foo',
  });

  const local = parseSource(FIXTURE_REPO);
  assert.equal(local.kind, 'local');
  assert.equal(sourceLabel(local), path.resolve(FIXTURE_REPO));

  assert.throws(() => parseSource('not a source!!'), /unrecognised source/);
});
