/**
 * The hub: a plain folder of skill directories plus one small JSON config.
 *
 * Keeping state in `skillhub.json` (and everything else as ordinary files) means
 * the hub is a git repository that diffs nicely, reviews well, and can be
 * cloned onto a second machine without any database migration.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse } from './frontmatter.js';
import { estimateCatalogTokens, estimateTokens } from './tokens.js';

export const CONFIG_NAME = 'skillhub.json';
export const SKILL_FILE = 'SKILL.md';

/** @typedef {{ version: number, shelf: string[] | null, tools: any[], sources: Record<string, any> }} HubConfig */

/** @typedef {{
 *   name: string,
 *   description: string,
 *   disableModelInvocation: boolean,
 *   path: string,
 *   files: number,
 *   bytes: number,
 *   catalogTokens: number,
 *   bodyTokens: number,
 *   updatedAt: string,
 *   source: string | null
 * }} Skill */

/**
 * @param {string} hubDir
 * @returns {string}
 */
export function configPath(hubDir) {
  return path.join(hubDir, CONFIG_NAME);
}

/**
 * @param {string} hubDir
 * @returns {HubConfig}
 */
export function loadConfig(hubDir) {
  const file = configPath(hubDir);
  const base = { version: 1, shelf: null, tools: [], sources: {} };
  try {
    // Windows editors (Notepad, PowerShell's Set-Content) happily prepend a BOM,
    // and JSON.parse rejects it. Strip it so a hand-edited config is not silently
    // ignored — which used to look like "my tools setting does nothing".
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      shelf: Array.isArray(parsed.shelf) ? parsed.shelf : null,
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      sources: parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {},
    };
  } catch {
    return base;
  }
}

/**
 * @param {string} hubDir
 * @param {HubConfig} config
 */
export function saveConfig(hubDir, config) {
  fs.mkdirSync(hubDir, { recursive: true });
  const budget = Number(config.budget);
  const dailyRequests = Number(config.dailyRequests);
  const ordered = {
    version: 1,
    shelf: config.shelf ?? null,
    // Preferences are optional: keep them out of the file unless the user set them.
    ...(Number.isFinite(budget) && budget > 0 ? { budget: Math.round(budget) } : {}),
    ...(Number.isFinite(dailyRequests) && dailyRequests > 0 ? { dailyRequests: Math.round(dailyRequests) } : {}),
    tools: config.tools ?? [],
    sources: config.sources ?? {},
  };
  fs.writeFileSync(configPath(hubDir), `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} hubDir
 * @returns {boolean}
 */
export function isHub(hubDir) {
  return fs.existsSync(configPath(hubDir)) || fs.existsSync(path.join(hubDir, SKILL_FILE));
}

/**
 * Create the hub folder if needed. Idempotent.
 *
 * @param {string} hubDir
 * @returns {{ created: boolean }}
 */
export function ensureHub(hubDir) {
  const created = !fs.existsSync(hubDir);
  fs.mkdirSync(hubDir, { recursive: true });
  if (!fs.existsSync(configPath(hubDir))) saveConfig(hubDir, loadConfig(hubDir));
  return { created };
}

/**
 * @param {string} hubDir
 * @returns {Skill[]}
 */
export function listSkills(hubDir) {
  /** @type {Skill[]} */
  const skills = [];
  let entries;
  try {
    entries = fs.readdirSync(hubDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  const config = loadConfig(hubDir);
  const sourceOf = buildSourceIndex(config);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // .git, .desc-backup, .skillhub-cache
    const dir = path.join(hubDir, entry.name);
    const skillFile = path.join(dir, SKILL_FILE);
    if (!fs.existsSync(skillFile)) continue;

    const text = fs.readFileSync(skillFile, 'utf8');
    const { data, body } = parse(text);
    const stats = walkStats(dir);

    skills.push({
      name: entry.name,
      description: (data.description ?? '').trim(),
      disableModelInvocation: String(data['disable-model-invocation'] ?? '').toLowerCase() === 'true',
      path: dir,
      files: stats.files,
      bytes: stats.bytes,
      catalogTokens: estimateCatalogTokens({ name: entry.name, description: data.description ?? '' }),
      bodyTokens: estimateTokens(body),
      updatedAt: stats.updatedAt,
      source: sourceOf.get(entry.name) ?? null,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * @param {string} hubDir
 * @param {string} name
 * @returns {{ name: string, description: string, markdown: string, path: string }}
 */
export function readSkill(hubDir, name) {
  const dir = resolveSkillDir(hubDir, name);
  const markdown = fs.readFileSync(path.join(dir, SKILL_FILE), 'utf8');
  const { data } = parse(markdown);
  return { name, description: (data.description ?? '').trim(), markdown, path: dir };
}

/**
 * Copy a skill folder into the hub.
 *
 * @param {string} sourceDir
 * @param {string} hubDir
 * @param {{ name?: string, overwrite?: boolean }} [options]
 * @returns {{ name: string, action: 'added' | 'updated' | 'skipped' }}
 */
export function installFromDir(sourceDir, hubDir, options = {}) {
  const name = sanitizeName(options.name ?? skillNameFromDir(sourceDir));
  if (!name) throw new Error(`cannot derive a skill name from ${sourceDir}`);

  const target = path.join(hubDir, name);
  const exists = fs.existsSync(target);

  if (exists && !options.overwrite) return { name, action: 'skipped' };
  if (exists) {
    const guard = path.resolve(target);
    if (!guard.startsWith(path.resolve(hubDir) + path.sep)) {
      throw new Error(`refusing to replace a path outside the hub: ${guard}`);
    }
    if (fs.lstatSync(guard).isSymbolicLink()) {
      throw new Error(`hub entry "${name}" is a link; remove it by hand first`);
    }
    fs.rmSync(guard, { recursive: true, force: true });
  }

  fs.cpSync(sourceDir, target, { recursive: true, dereference: false });
  return { name, action: exists ? 'updated' : 'added' };
}

/**
 * Delete a skill from the hub (never through a link).
 *
 * @param {string} hubDir
 * @param {string} name
 * @returns {boolean}
 */
export function removeSkill(hubDir, name) {
  const dir = resolveSkillDir(hubDir, name);
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`refusing to delete a link: ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * @param {Skill[]} skills
 * @param {string[] | null} shelf
 * @returns {{ count: number, onShelf: number, catalogTokens: number, visibleTokens: number }}
 */
export function summarize(skills, shelf) {
  const onShelf = shelf === null ? skills.length : skills.filter((s) => shelf.includes(s.name)).length;
  const catalogTokens = skills.reduce((sum, s) => sum + s.catalogTokens, 0);
  const visibleTokens = (shelf === null ? skills : skills.filter((s) => shelf.includes(s.name)))
    .reduce((sum, s) => sum + s.catalogTokens, 0);
  return { count: skills.length, onShelf, catalogTokens, visibleTokens };
}

/**
 * @param {string} hubDir
 * @param {string} name
 * @returns {string}
 */
export function resolveSkillDir(hubDir, name) {
  const clean = String(name ?? '').trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.startsWith('.')) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  }
  const dir = path.join(hubDir, clean);
  if (!dir.startsWith(path.resolve(hubDir) + path.sep)) throw new Error(`skill escapes the hub: ${clean}`);
  if (!fs.existsSync(path.join(dir, SKILL_FILE))) throw new Error(`no such skill: ${clean}`);
  return dir;
}

/**
 * @param {string} dir
 * @returns {string}
 */
export function skillNameFromDir(dir) {
  const skillFile = path.join(dir, SKILL_FILE);
  if (fs.existsSync(skillFile)) {
    const { data } = parse(fs.readFileSync(skillFile, 'utf8'));
    const fromFrontmatter = sanitizeName(data.name);
    if (fromFrontmatter) return fromFrontmatter;
  }
  return sanitizeName(path.basename(dir));
}

/**
 * @param {string} name
 * @returns {string}
 */
export function sanitizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * @param {string} dir
 * @returns {{ files: number, bytes: number, updatedAt: string }}
 */
function walkStats(dir) {
  let files = 0;
  let bytes = 0;
  let updated = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          files += 1;
          bytes += stat.size;
          updated = Math.max(updated, stat.mtimeMs);
        } catch {
          /* ignore unreadable file */
        }
      }
    }
  }
  return { files, bytes, updatedAt: updated ? new Date(updated).toISOString() : new Date(0).toISOString() };
}

/**
 * @param {HubConfig} config
 * @returns {Map<string, string>}
 */
function buildSourceIndex(config) {
  const index = new Map();
  for (const [key, value] of Object.entries(config.sources ?? {})) {
    const skills = Array.isArray(value?.skills) ? value.skills : [];
    for (const skill of skills) index.set(skill, key);
  }
  return index;
}
