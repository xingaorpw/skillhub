/**
 * Installing skills from GitHub (or any folder on disk) into the hub.
 *
 * GitHub archives are fetched from `codeload` over HTTPS — no git binary, no
 * GitHub token, no rate limit for public repos. That matters because the target
 * machine often has neither git nor a working corporate proxy for `git clone`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SKILL_FILE, installFromDir, skillNameFromDir } from './hub.js';
import { extractZip } from './zip.js';

/** @typedef {{ kind: 'local', dir: string } | { kind: 'github', owner: string, repo: string, ref: string | null, sub: string | null }} Source */

/**
 * @param {string} spec
 * @returns {Source}
 */
export function parseSource(spec) {
  const value = String(spec ?? '').trim();
  if (!value) throw new Error('empty source');

  if (fs.existsSync(value)) return { kind: 'local', dir: path.resolve(value) };

  const url = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/i.exec(value);
  if (url) {
    return {
      kind: 'github',
      owner: url[1],
      repo: url[2],
      ref: url[3] ? decodeURIComponent(url[3]) : null,
      sub: url[4] ? decodeURIComponent(url[4]) : null,
    };
  }

  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (short) return { kind: 'github', owner: short[1], repo: short[2], ref: null, sub: null };

  throw new Error(`unrecognised source: ${value} (use owner/repo, a GitHub URL, or a local path)`);
}

/**
 * @param {Source} source
 * @returns {string}
 */
export function sourceLabel(source) {
  if (source.kind === 'local') return source.dir;
  const base = `${source.owner}/${source.repo}`;
  const ref = source.ref ? `@${source.ref}` : '';
  const sub = source.sub ? `#${source.sub}` : '';
  return `${base}${ref}${sub}`;
}

/**
 * Download and extract a GitHub repository archive into a temp folder.
 *
 * @param {Extract<Source, { kind: 'github' }>} source
 * @param {(line: string) => void} [log]
 * @returns {Promise<{ dir: string, ref: string, cleanup: () => void }>}
 */
export async function fetchGitHubArchive(source, log = () => {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-'));
  const zipPath = path.join(work, 'archive.zip');
  const outDir = path.join(work, 'x');
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });

  const candidates = source.ref ? [source.ref] : ['main', 'master'];
  /** @type {Error | null} */
  let lastError = null;

  for (const ref of candidates) {
    const url = `https://codeload.github.com/${source.owner}/${source.repo}/zip/refs/heads/${ref}`;
    log(`fetch ${url}`);
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(zipPath, buffer);
      extractZip(buffer, outDir);
      const root = firstDirectory(outDir);
      if (!root) throw new Error('archive did not contain a repository folder');
      return { dir: root, ref, cleanup };
    } catch (error) {
      lastError = /** @type {Error} */ (error);
      log(`  ${ref} failed: ${lastError.message}`);
    }
  }

  cleanup();
  throw new Error(`could not download ${sourceLabel(source)}: ${lastError?.message ?? 'unknown error'}`);
}

/**
 * Find every folder that contains a `SKILL.md`, dropping nested matches so that
 * a skill which ships sub-skills is installed as one unit.
 *
 * @param {string} base
 * @returns {string[]}
 */
export function discoverSkillDirs(base) {
  /** @type {string[]} */
  const hits = [];
  const stack = [base];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasSkill = entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE);
    if (hasSkill) {
      hits.push(current);
      continue; // do not descend into a skill
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      stack.push(path.join(current, entry.name));
    }
  }

  return hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/**
 * Install one source into the hub.
 *
 * @param {string} spec
 * @param {string} hubDir
 * @param {{ overwrite?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ source: string, ref: string | null, installed: { name: string, action: string }[] }>}
 */
export async function installSource(spec, hubDir, options = {}) {
  const log = options.log ?? (() => {});
  const source = parseSource(spec);
  const label = sourceLabel(source);

  /** @type {{ dir: string, ref: string | null, cleanup: () => void }} */
  let fetched;
  if (source.kind === 'local') {
    fetched = { dir: source.dir, ref: null, cleanup: () => {} };
  } else {
    fetched = await fetchGitHubArchive(source, log);
  }

  try {
    let base = fetched.dir;
    if (source.kind === 'github' && source.sub) {
      const candidate = path.join(fetched.dir, ...source.sub.split('/').filter(Boolean));
      if (fs.existsSync(candidate)) base = candidate;
      else log(`  sub path "${source.sub}" not found, scanning the whole repository`);
    }

    const dirs = discoverSkillDirs(base);
    if (dirs.length === 0) throw new Error(`no ${SKILL_FILE} found in ${label}`);

    const installed = [];
    for (const dir of dirs) {
      const name = skillNameFromDir(dir);
      const result = installFromDir(dir, hubDir, { name, overwrite: options.overwrite });
      installed.push(result);
      log(`  ${result.action === 'skipped' ? 'skip   ' : result.action === 'updated' ? 'update ' : 'add    '} ${result.name}`);
    }
    return { source: label, ref: fetched.ref, installed };
  } finally {
    fetched.cleanup();
  }
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function firstDirectory(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (entries.length === 1) return path.join(dir, entries[0].name);
    // Archives normally contain exactly one top-level folder; be forgiving.
    return entries.length > 1 ? dir : null;
  } catch {
    return null;
  }
}
