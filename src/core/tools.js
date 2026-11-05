/**
 * Where each AI tool looks for skills.
 *
 * A "tool" is anything that scans a directory for `SKILL.md` folders. The
 * registry below covers the tools we have verified; anything else can be added
 * per project via `tools` in `skillhub.json` without touching this file.
 *
 * `create: true`  -> we may create the directory (the tool ships it by default)
 * `create: false` -> only use it when the directory already exists, so a tool we
 *                    merely *suspect* exists never gets a stray folder
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @typedef {{ id: string, label: string, dir: string, create: boolean }} ToolSpec */
/** @typedef {ToolSpec & { path: string, exists: boolean, parent: string }} ResolvedTool */

export const TOOL_REGISTRY = /** @type {ToolSpec[]} */ ([
  { id: 'dsh', label: 'DeepSeek Harness', dir: '.dsh/skills', create: true },
  { id: 'claude', label: 'Claude Code', dir: '.claude/skills', create: true },
  { id: 'codex', label: 'Codex CLI', dir: '.codex/skills', create: true },
  { id: 'cursor', label: 'Cursor', dir: '.cursor/skills', create: false },
  { id: 'workbuddy', label: 'WorkBuddy', dir: '.workbuddy/skills', create: false },
  { id: 'qoder', label: 'Qoder', dir: '.qoder/skills', create: false },
  { id: 'windsurf', label: 'Windsurf', dir: '.windsurf/skills', create: false },
  { id: 'gemini', label: 'Gemini CLI', dir: '.gemini/skills', create: false },
  { id: 'opencode', label: 'opencode', dir: '.config/opencode/skills', create: false },
]);

/**
 * Expand `~` and resolve relative tool dirs against the home directory.
 *
 * @param {string} dir
 * @param {string} [home]
 * @returns {string}
 */
export function resolveDir(dir, home = os.homedir()) {
  if (!dir) return home;
  if (dir === '~') return home;
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(home, dir.slice(2));
  return path.isAbsolute(dir) ? dir : path.join(home, dir);
}

/**
 * Merge the built-in registry with per-project overrides.
 *
 * If `config.tools` is non-empty it is treated as the complete list — explicit
 * configuration always wins over auto-detection, so a scripted or sandboxed run
 * can never touch a tool directory the user did not name.
 *
 * @param {{ tools?: Partial<ToolSpec>[] }} [config]
 * @returns {ToolSpec[]}
 */
export function allTools(config = {}) {
  const overrides = (Array.isArray(config.tools) ? config.tools : []).filter((tool) => tool?.id);
  if (overrides.length) {
    return overrides.map((override) => {
      const base = TOOL_REGISTRY.find((tool) => tool.id === override.id);
      return { ...(base ?? { id: override.id, label: override.id, dir: override.dir, create: true }), ...override };
    });
  }
  return TOOL_REGISTRY.map((tool) => ({ ...tool }));
}

/**
 * Tools that actually make sense on this machine right now.
 *
 * @param {{ tools?: Partial<ToolSpec>[] }} [config]
 * @param {string} [home]
 * @returns {ResolvedTool[]}
 */
export function detectTools(config = {}, home = os.homedir()) {
  const explicit = (Array.isArray(config.tools) ? config.tools : []).some((tool) => tool?.id);
  const found = [];

  for (const tool of allTools(config)) {
    if (!tool.dir) continue;
    const dir = resolveDir(tool.dir, home);
    const parent = path.dirname(dir);
    const exists = safeIsDir(dir);

    // Explicitly configured tools are always honoured, even before their folder
    // exists. Auto-detected ones must already exist (or be creatable) to avoid
    // scattering folders for tools the user does not have.
    if (!explicit && !exists && !(tool.create && safeIsDir(parent))) continue;

    found.push({ ...tool, path: dir, exists, parent });
  }
  return found;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function safeIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Human-readable platform hint used by `skillhub doctor`.
 *
 * @returns {string}
 */
export function platformLabel() {
  return `${process.platform} ${process.arch} · node ${process.versions.node}`;
}
