import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureHub, installFromDir, listSkills } from '../src/core/hub.js';
import { applyPlan, buildPlan, countByAction } from '../src/core/plan.js';
import { createLink, entryKind, linkTarget } from '../src/core/linker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.join(__dirname, 'fixtures', 'repo');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-plan-'));
  const hubDir = path.join(root, 'hub');
  const toolPath = path.join(root, 'tool', 'skills');
  ensureHub(hubDir);
  for (const dir of [path.join(FIXTURE_REPO, 'skills', 'alpha'), path.join(FIXTURE_REPO, 'skills', 'beta')]) {
    installFromDir(dir, hubDir);
  }
  const skills = listSkills(hubDir);
  const tools = [{ id: 'fake', label: 'Fake Tool', path: toolPath, exists: true }];
  return { root, hubDir, toolPath, skills, tools };
}

test('plans links only for skills on the shelf', () => {
  const { hubDir, skills, tools } = setup();
  const plan = buildPlan({ hubDir, skills, tools, shelf: ['alpha'] });

  const alpha = plan.items.find((item) => item.skill === 'alpha');
  const beta = plan.items.find((item) => item.skill === 'beta');
  assert.equal(alpha.action, 'create');
  assert.equal(beta.action, 'ok');
  assert.equal(countByAction(plan.items).create, 1);
});

test('a chained link is planned as a relink and replaced with a direct one', () => {
  const { root, hubDir, toolPath, skills, tools } = setup();
  const middle = path.join(root, 'middle', 'alpha');
  fs.mkdirSync(path.dirname(middle), { recursive: true });
  createLink(path.join(hubDir, 'alpha'), middle);
  createLink(middle, path.join(toolPath, 'alpha'));

  const plan = buildPlan({ hubDir, skills, tools, shelf: ['alpha'] });
  const item = plan.items.find((entry) => entry.skill === 'alpha');
  assert.equal(item.action, 'relink');
  assert.equal(countByAction(plan.items).relink, 1);

  const result = applyPlan(plan, { hubDir, tools });
  assert.equal(result.relinked, 1);
  assert.equal(linkTarget(path.join(toolPath, 'alpha')), path.join(hubDir, 'alpha'));
});

test('a null shelf means everything is linked', () => {
  const { hubDir, skills, tools } = setup();
  const plan = buildPlan({ hubDir, skills, tools, shelf: null });
  assert.equal(countByAction(plan.items).create, 2);
});

test('applying the plan creates junctions and is idempotent', () => {
  const { hubDir, toolPath, skills, tools } = setup();

  const first = buildPlan({ hubDir, skills, tools, shelf: ['alpha'] });
  const result = applyPlan(first, { hubDir, tools });
  assert.equal(result.created, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(entryKind(path.join(toolPath, 'alpha')), 'link');
  assert.equal(fs.existsSync(path.join(toolPath, 'alpha', 'SKILL.md')), true);

  const second = buildPlan({ hubDir, skills, tools, shelf: ['alpha'] });
  assert.equal(countByAction(second.items).create, 0);
  const again = applyPlan(second, { hubDir, tools });
  assert.equal(again.created, 0);
});

test('taking a skill off the shelf removes only its link', () => {
  const { hubDir, toolPath, skills, tools } = setup();
  applyPlan(buildPlan({ hubDir, skills, tools, shelf: null }), { hubDir, tools });
  assert.equal(entryKind(path.join(toolPath, 'alpha')), 'link');
  assert.equal(entryKind(path.join(toolPath, 'beta')), 'link');

  const plan = buildPlan({ hubDir, skills, tools, shelf: [] });
  const result = applyPlan(plan, { hubDir, tools });
  assert.equal(result.removed, 2);
  assert.equal(entryKind(path.join(toolPath, 'alpha')), 'missing');
  assert.equal(fs.existsSync(path.join(hubDir, 'alpha', 'SKILL.md')), true);
});

test('dry-run reports the work without touching the filesystem', () => {
  const { hubDir, toolPath, skills, tools } = setup();
  const plan = buildPlan({ hubDir, skills, tools, shelf: null });
  const result = applyPlan(plan, { hubDir, tools, dryRun: true });

  assert.equal(result.created, 2);
  assert.equal(entryKind(path.join(toolPath, 'alpha')), 'missing');
});

test('a hand-installed real folder is reported, never replaced', () => {
  const { hubDir, toolPath, skills, tools } = setup();
  fs.mkdirSync(path.join(toolPath, 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(toolPath, 'alpha', 'SKILL.md'), 'hand installed');

  const plan = buildPlan({ hubDir, skills, tools, shelf: null });
  const alpha = plan.items.find((item) => item.skill === 'alpha');
  assert.equal(alpha.action, 'blocked');

  const result = applyPlan(plan, { hubDir, tools });
  assert.equal(result.created, 1);
  assert.equal(fs.readFileSync(path.join(toolPath, 'alpha', 'SKILL.md'), 'utf8'), 'hand installed');
});
