/**
 * Planning and applying the hub → tool links.
 *
 * Everything is expressed as a plan first: `skillhub link --dry-run` prints
 * exactly what would happen, and the same plan object is what the web console
 * renders before the user clicks "应用". One code path, no surprises.
 */

import path from 'node:path';

import { createLink, inspectLink, removeLink } from './linker.js';

/** @typedef {'create' | 'relink' | 'remove' | 'ok' | 'blocked' | 'foreign'} PlanAction */
/** @typedef {{ tool: string, toolLabel: string, skill: string, action: PlanAction, detail: string }} PlanItem */
/** @typedef {{ items: PlanItem[], counts: Record<string, number> }} Plan */

/**
 * @param {{
 *   hubDir: string,
 *   skills: { name: string }[],
 *   tools: { id: string, label: string, path: string, exists: boolean }[],
 *   shelf: string[] | null
 * }} input
 * @returns {Plan}
 */
export function buildPlan({ hubDir, skills, tools, shelf }) {
  /** @type {PlanItem[]} */
  const items = [];

  for (const tool of tools) {
    for (const skill of skills) {
      const linkPath = joinPath(tool.path, skill.name);
      const current = inspectLink(linkPath, hubDir);
      const wanted = shelf === null || shelf.includes(skill.name);

      if (wanted) {
        if (current.state === 'missing') {
          items.push({ tool: tool.id, toolLabel: tool.label, skill: skill.name, action: 'create', detail: 'link' });
        } else if (current.state === 'linked') {
          items.push({ tool: tool.id, toolLabel: tool.label, skill: skill.name, action: 'ok', detail: 'already linked' });
        } else if (current.state === 'chained') {
          items.push({
            tool: tool.id,
            toolLabel: tool.label,
            skill: skill.name,
            action: 'relink',
            detail: `reached the hub through ${current.target}`,
          });
        } else if (current.state === 'linked-elsewhere') {
          items.push({
            tool: tool.id,
            toolLabel: tool.label,
            skill: skill.name,
            action: 'foreign',
            detail: `already a link to ${current.target}`,
          });
        } else {
          items.push({
            tool: tool.id,
            toolLabel: tool.label,
            skill: skill.name,
            action: 'blocked',
            detail: 'a real folder with this name is in the way',
          });
        }
      } else if (current.state === 'linked') {
        items.push({ tool: tool.id, toolLabel: tool.label, skill: skill.name, action: 'remove', detail: 'off the shelf' });
      } else if (current.state === 'linked-elsewhere') {
        items.push({
          tool: tool.id,
          toolLabel: tool.label,
          skill: skill.name,
          action: 'foreign',
          detail: `left alone: link to ${current.target}`,
        });
      } else {
        items.push({ tool: tool.id, toolLabel: tool.label, skill: skill.name, action: 'ok', detail: 'not present' });
      }
    }
  }

  return { items, counts: countByAction(items) };
}

/**
 * @param {Plan} plan
 * @param {{ dryRun?: boolean, hubDir: string, tools: { id: string, path: string }[], onItem?: (item: PlanItem) => void }} options
 * @returns {{ created: number, removed: number, failed: { item: PlanItem, error: string }[] }}
 */
export function applyPlan(plan, options) {
  const { dryRun = false, hubDir, tools, onItem = () => {} } = options;
  const toolPath = new Map(tools.map((tool) => [tool.id, tool.path]));

  let created = 0;
  let removed = 0;
  let relinked = 0;
  /** @type {{ item: PlanItem, error: string }[]} */
  const failed = [];

  for (const item of plan.items) {
    if (item.action !== 'create' && item.action !== 'remove' && item.action !== 'relink') {
      onItem(item);
      continue;
    }

    const base = toolPath.get(item.tool);
    if (!base) {
      failed.push({ item, error: `unknown tool: ${item.tool}` });
      continue;
    }
    const linkPath = joinPath(base, item.skill);

    try {
      if (!dryRun) {
        if (item.action === 'create') {
          createLink(joinPath(hubDir, item.skill), linkPath);
        } else if (item.action === 'remove') {
          removeLink(linkPath);
        } else {
          // Same destination, but through a chain: replace it with a direct link
          // so the gate does not depend on another tool folder staying alive.
          removeLink(linkPath);
          createLink(joinPath(hubDir, item.skill), linkPath);
        }
      }
      if (item.action === 'create') created += 1;
      else if (item.action === 'remove') removed += 1;
      else relinked += 1;
      onItem(item);
    } catch (error) {
      failed.push({ item, error: /** @type {Error} */ (error).message });
    }
  }

  return { created, removed, relinked, failed };
}

/**
 * Count plan items by action, always returning every key (so callers can read
 * `counts.create` without `?? 0`).
 *
 * @param {PlanItem[]} items
 * @returns {Record<string, number>}
 */
export function countByAction(items) {
  /** @type {Record<string, number>} */
  const counts = { create: 0, relink: 0, remove: 0, ok: 0, blocked: 0, foreign: 0 };
  for (const item of items) counts[item.action] = (counts[item.action] ?? 0) + 1;
  return counts;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function joinPath(a, b) {
  return path.join(a, b);
}
