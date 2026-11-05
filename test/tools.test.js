import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { allTools, detectTools, resolveDir, TOOL_REGISTRY } from '../src/core/tools.js';

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-home-'));
  return home;
}

test('resolveDir expands ~ and keeps absolute paths', () => {
  const home = path.join('C:', 'Users', 'demo');
  assert.equal(resolveDir('~/skills', home), path.join(home, 'skills'));
  assert.equal(resolveDir('~', home), home);
  assert.equal(resolveDir(path.join(home, 'x'), home), path.join(home, 'x'));
  assert.equal(resolveDir('relative/skills', home), path.join(home, 'relative', 'skills'));
});

test('auto-detection only returns tools that exist (or are creatable)', () => {
  const home = fakeHome();
  // No tool folders at all: only tools with create:true whose parent exists qualify.
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  const found = detectTools({}, home).map((tool) => tool.id);

  assert.ok(found.includes('dsh'), 'dsh has a real parent and create:true');
  assert.ok(!found.includes('cursor'), 'cursor is create:false and missing');
  assert.ok(!found.includes('windsurf'));
});

test('an existing folder enables a create:false tool', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, '.cursor', 'skills'), { recursive: true });
  const found = detectTools({}, home).map((tool) => tool.id);
  assert.ok(found.includes('cursor'));
});

test('explicit tools replace auto-detection entirely', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  const config = { tools: [{ id: 'custom', label: 'Custom', dir: '~/custom-skills', create: true }] };

  const found = detectTools(config, home);
  assert.deepEqual(
    found.map((tool) => tool.id),
    ['custom'],
  );
  assert.equal(found[0].path, path.join(home, 'custom-skills'));
});

test('explicit tools are honoured even before their folder exists', () => {
  const home = fakeHome();
  const config = { tools: [{ id: 'later', label: 'Later', dir: '~/later/skills' }] };
  const found = detectTools(config, home);
  assert.equal(found.length, 1);
  assert.equal(found[0].exists, false);
});

test('overrides can change the directory of a built-in tool', () => {
  const home = fakeHome();
  const config = { tools: [{ id: 'claude', dir: '~/custom/claude-skills' }] };
  const found = detectTools(config, home);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, path.join(home, 'custom', 'claude-skills'));
  assert.equal(found[0].label, 'Claude Code');
});

test('allTools returns a fresh copy of the registry by default', () => {
  const first = allTools();
  first[0].label = 'mutated';
  const second = allTools();
  assert.notEqual(second[0].label, 'mutated');
  assert.equal(second.length, TOOL_REGISTRY.length);
});

test('the registry has no duplicate ids', () => {
  const ids = TOOL_REGISTRY.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length);
});
