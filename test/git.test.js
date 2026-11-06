import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findGit, gitInit, gitStatus, HUB_GITIGNORE } from '../src/core/git.js';

function tempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-git-'));
  const hub = path.join(dir, 'hub');
  fs.mkdirSync(path.join(hub, 'alpha'), { recursive: true });
  fs.writeFileSync(
    path.join(hub, 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n',
    'utf8',
  );
  return hub;
}

const git = findGit();

test('findGit always answers, installed or not', () => {
  assert.equal(typeof git.available, 'boolean');
  if (git.available) {
    assert.match(git.version, /^git version/);
    assert.ok(git.path.length > 0);
  } else {
    assert.equal(git.version, null);
  }
});

test('a plain folder is not a repository', () => {
  const hub = tempHub();
  const status = gitStatus(hub);
  assert.equal(status.isRepo, false);
  assert.equal(status.branch, null);
  assert.equal(status.remote, null);
  assert.equal(status.dirty, null);
});

test('gitInit writes a .gitignore even without git', () => {
  const hub = tempHub();
  const result = gitInit(hub);

  assert.equal(fs.existsSync(path.join(hub, '.gitignore')), true);
  assert.equal(fs.readFileSync(path.join(hub, '.gitignore'), 'utf8'), HUB_GITIGNORE);
  assert.equal(result.gitignore, true);
  assert.ok(result.next.length > 0);

  if (!git.available) {
    assert.equal(result.ok, false);
    assert.match(result.reason, /git/i);
    assert.ok(result.next.includes('git init -b main'));
  }
});

test('gitInit creates a repository with an initial commit', { skip: !git.available }, () => {
  const hub = tempHub();
  const result = gitInit(hub, { commitMessage: 'chore: first' });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(fs.existsSync(path.join(hub, '.git')), true);

  const status = gitStatus(hub);
  assert.equal(status.isRepo, true);
  assert.equal(status.branch, 'main');
  assert.equal(status.commits, 1);
  assert.equal(status.dirty, 0);
  assert.equal(status.gitAvailable, true);
});

test('gitInit is idempotent', { skip: !git.available }, () => {
  const hub = tempHub();
  gitInit(hub);
  const second = gitInit(hub);

  assert.equal(second.ok, true);
  assert.equal(second.committed, false, 'nothing staged means no new commit');
  assert.equal(second.gitignore, false, 'existing .gitignore is kept');
  assert.equal(gitStatus(hub).commits, 1);
});

test('gitInit commits even when the machine has no git identity', { skip: !git.available }, () => {
  const hub = tempHub();
  const emptyConfig = path.join(hub, '..', 'empty-gitconfig');
  fs.writeFileSync(emptyConfig, '', 'utf8');

  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    system: process.env.GIT_CONFIG_SYSTEM,
  };
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_SYSTEM = emptyConfig;
  try {
    const result = gitInit(hub, { commitMessage: 'chore: first' });
    assert.equal(result.ok, true);
    assert.equal(result.committed, true, 'a missing identity must not block the first commit');
    assert.equal(result.identity?.name, 'SkillHub');
    assert.equal(gitStatus(hub).commits, 1);
  } finally {
    if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.global;
    if (saved.system === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = saved.system;
  }
});

test('gitStatus counts uncommitted changes', { skip: !git.available }, () => {
  const hub = tempHub();
  gitInit(hub);
  fs.writeFileSync(path.join(hub, 'alpha', 'extra.md'), 'hello', 'utf8');

  assert.equal(gitStatus(hub).dirty, 1);
});

test('branch and remote are read from .git without shelling out', () => {
  const hub = tempHub();
  const gitDir = path.join(hub, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/dev\n', 'utf8');
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:me/skills.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    'utf8',
  );

  const status = gitStatus(hub);
  assert.equal(status.isRepo, true);
  assert.equal(status.branch, 'dev');
  assert.equal(status.remote, 'git@github.com:me/skills.git');
});
