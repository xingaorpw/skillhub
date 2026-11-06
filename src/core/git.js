/**
 * Git integration for the hub — the "sync across devices" story.
 *
 * The hub is designed to be a plain git repository, so this module only needs to
 * answer three questions: is it a repo, is there a remote, is anything
 * uncommitted. Everything degrades gracefully when git is not installed, because
 * the machine that needs a skill hub most is often the one where you cannot
 * install anything.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const HUB_GITIGNORE = `.DS_Store
Thumbs.db
desktop.ini
*.log
.skillhub-cache/
tmp/
`;

/** Used only when the machine has no git identity at all. */
const FALLBACK_IDENTITY = { name: 'SkillHub', email: 'skillhub@localhost' };

/** Extra places git is commonly installed but not on PATH. */
const GIT_CANDIDATES = [
  process.env.SKILLHUB_GIT,
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null,
  process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'cmd', 'git.exe') : null,
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.qoder', 'bin', 'git', 'bin', 'git.exe'),
].filter(Boolean);

/**
 * @returns {{ available: boolean, version: string | null, path: string }}
 */
export function findGit() {
  for (const candidate of ['git', ...GIT_CANDIDATES]) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      return { available: true, version: result.stdout.trim(), path: candidate };
    }
  }
  return { available: false, version: null, path: '' };
}

/**
 * @param {string} hubDir
 * @returns {{
 *   isRepo: boolean,
 *   gitAvailable: boolean,
 *   gitVersion: string | null,
 *   branch: string | null,
 *   remote: string | null,
 *   dirty: number | null,
 *   commits: number | null,
 *   ahead: number | null,
 *   initializedAt: string | null
 * }}
 */
export function gitStatus(hubDir) {
  const gitDir = path.join(hubDir, '.git');
  const isRepo = fs.existsSync(gitDir);
  const git = findGit();

  const status = {
    isRepo,
    gitAvailable: git.available,
    gitVersion: git.version,
    branch: null,
    remote: null,
    dirty: null,
    commits: null,
    ahead: null,
    initializedAt: null,
  };
  if (!isRepo) return status;

  status.branch = readBranch(gitDir);
  status.remote = readRemote(gitDir);

  try {
    status.initializedAt = fs.statSync(gitDir).birthtime.toISOString();
  } catch {
    /* some filesystems do not expose birthtime */
  }

  if (!git.available) return status;

  const dirty = runGit(hubDir, ['status', '--porcelain']);
  if (dirty !== null) status.dirty = dirty.split('\n').filter(Boolean).length;

  const count = runGit(hubDir, ['rev-list', '--count', 'HEAD']);
  if (count !== null) {
    const parsed = Number.parseInt(count.trim(), 10);
    status.commits = Number.isFinite(parsed) ? parsed : 0;
  }

  const ahead = runGit(hubDir, ['rev-list', '--count', '@{u}..HEAD']);
  if (ahead !== null) {
    const parsed = Number.parseInt(ahead.trim(), 10);
    status.ahead = Number.isFinite(parsed) ? parsed : 0;
  }

  return status;
}

/**
 * Make the hub a git repository, write a `.gitignore`, and create the first
 * commit. Safe to call repeatedly.
 *
 * @param {string} hubDir
 * @param {{ commitMessage?: string }} [options]
 * @returns {{ ok: boolean, reason?: string, gitignore: boolean, committed: boolean, status: ReturnType<typeof gitStatus>, next: string[] }}
 */
export function gitInit(hubDir, options = {}) {
  const gitignorePath = path.join(hubDir, '.gitignore');
  let wroteGitignore = false;
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, HUB_GITIGNORE, 'utf8');
    wroteGitignore = true;
  }

  const git = findGit();
  const next = [
    'git remote add origin git@github.com:<you>/my-skills.git',
    'git push -u origin main',
  ];

  if (!git.available) {
    return {
      ok: false,
      reason: 'git is not installed (or not on PATH); the hub is ready, but commit it with any git client',
      gitignore: wroteGitignore,
      committed: false,
      status: gitStatus(hubDir),
      next: ['git init -b main', 'git add -A', 'git commit -m "chore: add skills"', ...next],
    };
  }

  if (!fs.existsSync(path.join(hubDir, '.git'))) {
    const init = spawnSync(git.path, ['init', '-b', 'main'], { cwd: hubDir, encoding: 'utf8' });
    if (init.status !== 0) {
      return {
        ok: false,
        reason: (init.stderr || init.stdout || 'git init failed').trim(),
        gitignore: wroteGitignore,
        committed: false,
        status: gitStatus(hubDir),
        next,
      };
    }
  }

  spawnSync(git.path, ['add', '-A'], { cwd: hubDir, encoding: 'utf8' });
  const staged = runGit(hubDir, ['diff', '--cached', '--name-only']) ?? '';
  let committed = false;
  let identity = null;
  if (staged.trim()) {
    const message = options.commitMessage ?? `chore: sync skills (${new Date().toISOString().slice(0, 10)})`;
    // A brand-new machine has no `user.name` / `user.email`, and `git commit`
    // then fails with "Please tell me who you are". Set a repo-local identity
    // rather than leaving the user with an uncommitted repository.
    if (!hasIdentity(git.path, hubDir)) {
      identity = FALLBACK_IDENTITY;
      spawnSync(git.path, ['-C', hubDir, 'config', 'user.name', identity.name], { encoding: 'utf8' });
      spawnSync(git.path, ['-C', hubDir, 'config', 'user.email', identity.email], { encoding: 'utf8' });
    }
    const commit = spawnSync(git.path, ['commit', '-m', message], { cwd: hubDir, encoding: 'utf8' });
    committed = commit.status === 0;
  }

  return { ok: true, gitignore: wroteGitignore, committed, identity, status: gitStatus(hubDir), next };
}

/**
 * True when git can resolve an author name and email for this repository
 * (local config first, then global and system).
 *
 * @param {string} gitPath
 * @param {string} hubDir
 * @returns {boolean}
 */
function hasIdentity(gitPath, hubDir) {
  for (const key of ['user.name', 'user.email']) {
    const result = spawnSync(gitPath, ['-C', hubDir, 'config', key], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || !String(result.stdout ?? '').trim()) return false;
  }
  return true;
}

/**
 * @param {string} hubDir
 * @param {string[]} args
 * @returns {string | null}
 */
function runGit(hubDir, args) {
  const git = findGit();
  if (!git.available) return null;
  const result = spawnSync(git.path, ['-C', hubDir, ...args], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) return null;
  return result.stdout ?? '';
}

/**
 * @param {string} gitDir
 * @returns {string | null}
 */
function readBranch(gitDir) {
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return match ? match[1] : '(detached)';
  } catch {
    return null;
  }
}

/**
 * @param {string} gitDir
 * @returns {string | null}
 */
function readRemote(gitDir) {
  try {
    const config = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
    const section = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/.exec(config);
    if (!section) return null;
    const url = /url\s*=\s*(.+)/.exec(section[1]);
    return url ? url[1].trim() : null;
  } catch {
    return null;
  }
}
