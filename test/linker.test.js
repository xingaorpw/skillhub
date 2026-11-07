import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLink, entryKind, inspectLink, isLinkedInto, linkTarget, removeLink } from '../src/core/linker.js';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-link-'));
  const hub = path.join(root, 'hub');
  const tools = path.join(root, 'tools');
  fs.mkdirSync(path.join(hub, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(hub, 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  fs.mkdirSync(tools, { recursive: true });
  return { root, hub, tools, link: path.join(tools, 'demo') };
}

test('creates a link that resolves to the hub skill', () => {
  const { hub, link } = workspace();
  createLink(path.join(hub, 'demo'), link);

  assert.equal(entryKind(link), 'link');
  assert.equal(linkTarget(link), path.join(hub, 'demo'));
  assert.equal(isLinkedInto(link, hub), true);
  assert.match(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), /name: demo/);
  assert.deepEqual(inspectLink(link, hub).state, 'linked');
});

test('a link that reaches the hub through another folder is reported as chained', () => {
  const { root, hub, link } = workspace();
  const middle = path.join(root, 'middle', 'demo');
  fs.mkdirSync(path.dirname(middle), { recursive: true });
  createLink(path.join(hub, 'demo'), middle);
  createLink(middle, link);

  const state = inspectLink(link, hub);
  assert.equal(state.state, 'chained');
  assert.equal(state.target, middle);
});

test('removing a link leaves the target untouched', () => {
  const { hub, link } = workspace();
  createLink(path.join(hub, 'demo'), link);
  assert.equal(removeLink(link), true);

  assert.equal(entryKind(link), 'missing');
  assert.equal(fs.existsSync(path.join(hub, 'demo', 'SKILL.md')), true);
});

test('refuses to remove a real directory', () => {
  const { tools } = workspace();
  const real = path.join(tools, 'real');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'keep.txt'), 'keep');

  assert.throws(() => removeLink(real), /refusing to remove a real path/);
  assert.equal(fs.existsSync(path.join(real, 'keep.txt')), true);
});

test('refuses to overwrite an existing path', () => {
  const { hub, tools } = workspace();
  const occupied = path.join(tools, 'occupied');
  fs.mkdirSync(occupied);
  assert.throws(() => createLink(path.join(hub, 'demo'), occupied), /refusing to overwrite/);
});

test('refuses to link a missing target', () => {
  const { tools } = workspace();
  assert.throws(() => createLink(path.join(tools, 'nope'), path.join(tools, 'x')), /does not exist/);
});

test('reports a real folder as blocked instead of silently replacing it', () => {
  const { hub, tools } = workspace();
  const blocked = path.join(tools, 'demo');
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(blocked, 'SKILL.md'), 'hand installed');
  assert.equal(inspectLink(blocked, hub).state, 'blocked');
});

test('reports a link pointing somewhere else as foreign', () => {
  const { hub, tools, root } = workspace();
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  const link = path.join(tools, 'demo');
  createLink(other, link);

  const inspected = inspectLink(link, hub);
  assert.equal(inspected.state, 'linked-elsewhere');
  assert.equal(inspected.target, other);
});

test('removing a missing link is a no-op', () => {
  const { tools } = workspace();
  assert.equal(removeLink(path.join(tools, 'nope')), false);
});
