/**
 * Public API surface. Everything the CLI, the HTTP server and the MCP server do
 * goes through these functions, so behaviour cannot drift between interfaces.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installSource, parseSource, sourceLabel } from './installer.js';
import { buildPlan, applyPlan, countByAction } from './plan.js';
import {
  CONFIG_NAME,
  ensureHub,
  isHub,
  listSkills,
  loadConfig,
  readSkill,
  removeSkill,
  saveConfig,
  summarize,
} from './hub.js';
import { detectTools, platformLabel, resolveDir, TOOL_REGISTRY } from './tools.js';

export {
  CONFIG_NAME,
  ensureHub,
  isHub,
  listSkills,
  loadConfig,
  readSkill,
  removeSkill,
  saveConfig,
  summarize,
  installSource,
  parseSource,
  sourceLabel,
  buildPlan,
  applyPlan,
  countByAction,
  detectTools,
  platformLabel,
  resolveDir,
  TOOL_REGISTRY,
};

export const DEFAULT_HUB = path.join(os.homedir(), '.skillhub');

/**
 * Where the hub lives, in priority order:
 *   1. explicit --hub
 *   2. $SKILLHUB_HOME
 *   3. the current directory, if it is already a hub (repo-local usage)
 *   4. ~/.skillhub
 *
 * @param {string} [explicit]
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveHubDir(explicit, cwd = process.cwd()) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SKILLHUB_HOME) return path.resolve(process.env.SKILLHUB_HOME);
  if (fs.existsSync(path.join(cwd, CONFIG_NAME))) return path.resolve(cwd);
  return DEFAULT_HUB;
}

/**
 * One call that answers "what does this hub look like right now?".
 *
 * @param {{ hubDir?: string, config?: any }} [options]
 */
export function getState(options = {}) {
  const hubDir = resolveHubDir(options.hubDir);
  const config = options.config ?? loadConfig(hubDir);
  const skills = listSkills(hubDir);
  const tools = detectTools(config).map((tool) => ({
    ...tool,
    links: skills.filter((skill) => {
      try {
        return fs.existsSync(path.join(tool.path, skill.name));
      } catch {
        return false;
      }
    }).length,
  }));
  const shelf = config.shelf;
  const stats = summarize(skills, shelf);

  return {
    hubDir,
    exists: fs.existsSync(hubDir),
    config,
    shelf,
    skills,
    tools,
    stats,
    platform: platformLabel(),
  };
}

/**
 * Turn skills on (add to the shelf). A `null` shelf means "everything is on",
 * so enabling the first skill materialises the full list.
 *
 * @param {string} hubDir
 * @param {string[]} names
 * @returns {{ shelf: string[], changed: string[] }}
 */
export function enableSkills(hubDir, names) {
  const config = loadConfig(hubDir);
  const all = listSkills(hubDir).map((skill) => skill.name);
  const current = config.shelf ?? all;
  const next = [...new Set([...current, ...names])].filter((name) => all.includes(name));
  config.shelf = all.filter((name) => next.includes(name));
  saveConfig(hubDir, config);
  return { shelf: config.shelf, changed: names.filter((name) => all.includes(name)) };
}

/**
 * Turn skills off (remove from the shelf). Skills stay in the hub; only the
 * links go away, which is what keeps the model's catalog small.
 *
 * @param {string} hubDir
 * @param {string[]} names
 * @returns {{ shelf: string[], changed: string[] }}
 */
export function disableSkills(hubDir, names) {
  const config = loadConfig(hubDir);
  const all = listSkills(hubDir).map((skill) => skill.name);
  const current = config.shelf ?? all;
  const next = current.filter((name) => !names.includes(name));
  config.shelf = all.filter((name) => next.includes(name));
  saveConfig(hubDir, config);
  return { shelf: config.shelf, changed: names.filter((name) => current.includes(name)) };
}

/**
 * Put every skill back on the shelf (`shelf: null`).
 *
 * @param {string} hubDir
 */
export function enableAll(hubDir) {
  const config = loadConfig(hubDir);
  config.shelf = null;
  saveConfig(hubDir, config);
  return { shelf: null };
}

/**
 * Recompute and (unless `dryRun`) apply the links for every tool.
 *
 * @param {{ hubDir?: string, dryRun?: boolean, tools?: string[], onItem?: (item: any) => void }} [options]
 */
export function linkAll(options = {}) {
  const state = getState({ hubDir: options.hubDir });
  const tools = options.tools?.length
    ? state.tools.filter((tool) => options.tools.includes(tool.id))
    : state.tools;

  const plan = buildPlan({ hubDir: state.hubDir, skills: state.skills, tools, shelf: state.shelf });
  const result = applyPlan(plan, {
    dryRun: options.dryRun ?? false,
    hubDir: state.hubDir,
    tools,
    onItem: options.onItem,
  });

  return { plan, result, tools };
}
