/**
 * Public API surface. Everything the CLI, the HTTP server and the MCP server do
 * goes through these functions, so behaviour cannot drift between interfaces.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installSource, parseSource, sourceLabel } from './installer.js';
import { importFiles } from './importer.js';
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
import { findGit, gitInit, gitStatus } from './git.js';
import { TIERS, projectUsage, tierOf } from './tokens.js';

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
  importFiles,
  buildPlan,
  applyPlan,
  countByAction,
  detectTools,
  platformLabel,
  resolveDir,
  TOOL_REGISTRY,
  findGit,
  gitInit,
  gitStatus,
  TIERS,
  tierOf,
  projectUsage,
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
 * Includes the numbers the console needs to make cost tangible: the shelf's
 * catalog cost, a projection over time, the most expensive skills, and the git
 * state used by the sync panel.
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
  const onShelf = (name) => shelf === null || shelf.includes(name);

  const budget = Number(config.budget) > 0 ? Number(config.budget) : 2000;
  const dailyRequests = Number(config.dailyRequests) > 0 ? Number(config.dailyRequests) : 100;

  const spenders = [...skills]
    .sort((a, b) => b.catalogTokens - a.catalogTokens || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((skill) => ({
      name: skill.name,
      catalogTokens: skill.catalogTokens,
      tier: tierOf(skill.catalogTokens).id,
      onShelf: onShelf(skill.name),
    }));

  const tiers = TIERS.map((tier) => ({
    id: tier.id,
    label: tier.label,
    hint: tier.hint,
    count: skills.filter((skill) => tierOf(skill.catalogTokens).id === tier.id).length,
  }));

  return {
    hubDir,
    exists: fs.existsSync(hubDir),
    config,
    shelf,
    skills,
    tools,
    stats,
    platform: platformLabel(),
    budget,
    dailyRequests,
    projection: projectUsage({ visibleTokens: stats.visibleTokens, dailyRequests }),
    savings: Math.max(0, stats.catalogTokens - stats.visibleTokens),
    spenders,
    tiers,
    git: gitStatus(hubDir),
  };
}

/**
 * Persist user preferences (budget + assumed request volume).
 *
 * @param {string} hubDir
 * @param {{ budget?: number, dailyRequests?: number }} patch
 */
export function savePreferences(hubDir, patch) {
  const config = loadConfig(hubDir);
  if (patch.budget !== undefined) {
    const value = Number(patch.budget);
    config.budget = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (patch.dailyRequests !== undefined) {
    const value = Number(patch.dailyRequests);
    config.dailyRequests = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  saveConfig(hubDir, config);
  return { budget: config.budget, dailyRequests: config.dailyRequests };
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
 * Add skills to a restricted shelf. When the shelf is `null` (everything is
 * visible) this is a no-op, because the new skill is already visible.
 *
 * Installing a skill should make it usable immediately — otherwise the user has
 * to find it and toggle it on, which reads like a bug.
 *
 * @param {string} hubDir
 * @param {string[]} names
 * @returns {string[] | null}
 */
export function addToShelf(hubDir, names) {
  const config = loadConfig(hubDir);
  if (config.shelf === null) return null;
  const merged = [...new Set([...config.shelf, ...names])].sort();
  config.shelf = merged;
  saveConfig(hubDir, config);
  return merged;
}

/**
 * Take every skill off the shelf (`shelf: []`). Skills stay in the hub; only the
 * links disappear.
 *
 * @param {string} hubDir
 */
export function disableAll(hubDir) {
  const config = loadConfig(hubDir);
  config.shelf = [];
  saveConfig(hubDir, config);
  return { shelf: [] };
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
