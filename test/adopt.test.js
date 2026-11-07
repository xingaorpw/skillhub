import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { adoptAll, adoptStray, findStrays } from '../src/core/adopt.js';
import { ensureHub, listSkills } from '../src/core/hub.js';
import { createLink, inspectLink } from '../src/core/linker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.join(__dirname, 'fixtures', 'repo');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-adopt-'));
  const hub = path.join(root, 'hub');
  const toolPath = path.join(root, 'tool', 'skills');
  fs.mkdirSync(toolPath, { recursive: true });
  ensureHub(hub);
  return { root, hub, toolPath, tools: [{ id: 'demo', label: 'Demo', path: toolPath }] };
}

/** Copy the alpha fixture into a tool folder, i.e. "the tool installed it itself". */
function dropStray(toolPath, name = 'alpha') {
  const source = path.join(FIXTURE_REPO, 'skills', name);
  const dest = path.join(toolPath, name);
  fs.cpSync(source, dest, { recursive: true });
  return dest;
}

test('findStrays only reports real skill folders', () => {
  const { hub, toolPath, tools } = setup();
  dropStray(toolPath, 'alpha');
  fs.mkdirSync(path.join(toolPath, 'not-a-skill'), { recursive: true });
  fs.writeFileSync(path.join(toolPath, 'notes.txt'), 'hi', 'utf8');
  // A link to the hub is the desired state, not a stray.
  fs.cpSync(path.join(FIXTURE_REPO, 'skills', 'beta'), path.join(hub, 'beta'), { recursive: true });
  createLink(path.join(hub, 'beta'), path.join(toolPath, 'beta'));

  const strays = findStrays(tools);
  assert.deepEqual(strays.map((stray) => stray.name), ['alpha']);
});

test('adoptStray moves the folder into the hub and leaves a link', () => {
  const { hub, toolPath, tools } = setup();
  const original = dropStray(toolPath, 'alpha');

  const result = adoptStray(hub, findStrays(tools)[0]);

  assert.equal(result.name, 'alpha');
  assert.equal(result.action, 'added');
  assert.ok(listSkills(hub).some((skill) => skill.name === 'alpha'), 'hub should own the skill');
  assert.equal(fs.existsSync(path.join(hub, 'alpha', 'SKILL.md')), true);
  assert.deepEqual(inspectLink(original, hub), {
    state: 'linked',
    target: path.join(hub, 'alpha'),
  });
});

test('adoptStray copies content faithfully before deleting the original', () => {
  const { hub, toolPath, tools } = setup();
  const original = dropStray(toolPath, 'alpha');
  const extra = path.join(original, 'references', 'notes.md');
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, 'keep me', 'utf8');

  adoptStray(hub, findStrays(tools)[0]);

  assert.equal(fs.readFileSync(path.join(hub, 'alpha', 'references', 'notes.md'), 'utf8'), 'keep me');
});

test('dryRun touches nothing', () => {
  const { hub, toolPath, tools } = setup();
  const original = dropStray(toolPath, 'alpha');

  const result = adoptStray(hub, findStrays(tools)[0], { dryRun: true });

  assert.equal(result.action, 'would-adopt');
  assert.equal(fs.existsSync(path.join(original, 'SKILL.md')), true);
  assert.equal(listSkills(hub).length, 0);
});

test('adoptAll keeps going after one failure and never deletes on doubt', () => {
  const { hub, toolPath, tools } = setup();
  dropStray(toolPath, 'alpha');

  // The hub already has a *different* beta, and the tool holds its own copy.
  fs.cpSync(path.join(FIXTURE_REPO, 'skills', 'beta'), path.join(hub, 'beta'), { recursive: true });
  const stray = dropStray(toolPath, 'beta');
  fs.writeFileSync(path.join(stray, 'local-only.md'), 'newer copy', 'utf8');

  const { adopted, failed } = adoptAll(hub, tools);

  assert.deepEqual(adopted.map((item) => item.name), ['alpha']);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].stray.name, 'beta');
  assert.match(failed[0].error, /incomplete|skipped/);
  // The tool copy must survive a failed adoption.
  assert.equal(fs.existsSync(path.join(stray, 'local-only.md')), true);
});

test('a real folder is never mistaken for a link', () => {
  const { hub, toolPath, tools } = setup();
  const original = dropStray(toolPath, 'alpha');
  adoptStray(hub, findStrays(tools)[0]);

  assert.equal(inspectLink(original, hub).state, 'linked');
  // Adopting again now finds nothing: the entry is a link.
  assert.deepEqual(findStrays(tools), []);
});
