import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureHub, installFromDir, loadConfig, saveConfig } from '../src/core/hub.js';
import { discoverSkillDirs } from '../src/core/installer.js';
import { ApiError, handleApi } from '../src/server/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.join(__dirname, 'fixtures', 'repo');

function tempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-api-'));
  const hub = path.join(dir, 'hub');
  ensureHub(hub);

  // Pin a fake tool directory: otherwise linking would write junctions into the
  // real ~/.dsh, ~/.claude, … of whoever runs the tests.
  const config = loadConfig(hub);
  config.tools = [{ id: 'demo', label: 'Demo', dir: path.join(dir, 'demo-tool'), create: true }];
  saveConfig(hub, config);

  for (const skill of discoverSkillDirs(FIXTURE_REPO)) installFromDir(skill, hub);
  return hub;
}

/**
 * @param {string} hubDir
 * @param {string} route
 * @param {{ body?: any, allowOpen?: boolean }} [options]
 */
async function call(hubDir, route, options = {}) {
  const [method, pathname] = route.split(' ');
  return handleApi({ method, pathname, body: options.body ?? null, hubDir, allowOpen: options.allowOpen ?? false });
}

test('GET /api/state carries everything the console renders', async () => {
  const hub = tempHub();
  const { status, json } = await call(hub, 'GET /api/state');

  assert.equal(status, 200);
  assert.equal(json.skills.length, 2);
  assert.equal(json.budget, 2000);
  assert.equal(json.dailyRequests, 100);
  assert.equal(json.tiers.length, 4);
  assert.equal(json.spenders.length, 2);
  assert.equal(typeof json.projection.perMonth, 'number');
  assert.match(json.version, /^\d+\.\d+\.\d+$/);
  assert.equal(json.git.isRepo, false);
  assert.ok(json.skills.every((skill) => typeof skill.tier === 'string'));
});

test('POST /api/preferences persists the budget', async () => {
  const hub = tempHub();
  const { json } = await call(hub, 'POST /api/preferences', { body: { budget: 900, dailyRequests: 7 } });

  assert.equal(json.budget, 900);
  assert.equal(json.projection.perDay, json.stats.visibleTokens * 7);
  assert.equal(loadConfig(hub).budget, 900);
});

test('POST /api/reveal points at the hub and never opens for remote clients', async () => {
  const hub = tempHub();
  const { json } = await call(hub, 'POST /api/reveal', { body: {} });

  assert.equal(json.path, path.resolve(hub));
  assert.equal(json.opened, false);
});

test('POST /api/reveal can target one skill folder', async () => {
  const hub = tempHub();
  const { json } = await call(hub, 'POST /api/reveal', { body: { skill: 'alpha' } });

  assert.equal(json.path, path.join(hub, 'alpha'));
  assert.equal(json.opened, false);
});

test('POST /api/reveal refuses traversal and unknown skills', async () => {
  const hub = tempHub();
  await assert.rejects(() => call(hub, 'POST /api/reveal', { body: { skill: '../..' } }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    return true;
  });
  await assert.rejects(() => call(hub, 'POST /api/reveal', { body: { skill: 'nope' } }), /no such skill/);
});

test('POST /api/shelf with mode=none empties the shelf', async () => {
  const hub = tempHub();
  const { json } = await call(hub, 'POST /api/shelf', { body: { mode: 'none' } });

  assert.deepEqual(json.shelf, []);
  assert.equal(json.stats.onShelf, 0);
  assert.deepEqual(loadConfig(hub).shelf, []);
});

test('toggling a skill returns the new state', async () => {
  const hub = tempHub();
  const off = await call(hub, 'POST /api/skills/alpha/disable', { body: {} });
  assert.equal(off.json.skills.find((skill) => skill.name === 'alpha').onShelf, false);

  const on = await call(hub, 'POST /api/skills/alpha/enable', { body: {} });
  assert.equal(on.json.skills.find((skill) => skill.name === 'alpha').onShelf, true);
});

test('POST /api/optimize plans without touching the shelf', async () => {
  const hub = tempHub();
  const { json } = await call(hub, 'POST /api/optimize', { body: { budget: 1 } });

  assert.equal(json.applied, false);
  assert.equal(json.plan.changed, true);
  assert.ok(json.plan.drop.length > 0);
  assert.equal(loadConfig(hub).shelf, null, 'a dry plan must not write the config');
  assert.equal(json.state, null);
});

test('POST /api/optimize can apply the plan', async () => {
  const hub = tempHub();
  const planned = await call(hub, 'POST /api/optimize', { body: { budget: 1 } });
  const { json } = await call(hub, 'POST /api/optimize', { body: { budget: 1, apply: true } });

  assert.equal(json.applied, true);
  assert.deepEqual(json.plan.drop, planned.json.plan.drop);
  assert.deepEqual(loadConfig(hub).shelf, json.plan.keep);
  assert.equal(json.state.stats.onShelf, json.plan.keep.length);
});

test('POST /api/shelf can restore an explicit list (what undo uses)', async () => {
  const hub = tempHub();
  await call(hub, 'POST /api/shelf', { body: { mode: 'none' } });

  const { json } = await call(hub, 'POST /api/shelf', { body: { mode: 'shelf', names: ['alpha', 'ghost'] } });
  assert.deepEqual(json.shelf, ['alpha']);
  assert.deepEqual(loadConfig(hub).shelf, ['alpha']);
});

test('unknown endpoints are a 404 ApiError', async () => {
  const hub = tempHub();
  await assert.rejects(() => call(hub, 'GET /api/nope'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    return true;
  });
});
