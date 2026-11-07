/**
 * Adoption of "stray" skills.
 *
 * Every tool can install skills on its own: a marketplace button, a `git clone`
 * into `~/.claude/skills`, a zip someone unzipped by hand. Those copies live
 * outside the hub, so the next tool does not see them and the catalog cost is
 * paid twice with no single place to update.
 *
 * This module moves such a folder into the hub and leaves a link behind, which
 * is what makes "everything lives in one place" true even when an installer did
 * not ask us first.
 *
 * Safety rule: the original is deleted only after the hub copy is verified to
 * have the same number of files and the same byte count.
 */

import fs from 'node:fs';
import path from 'node:path';

import { installFromDir } from './hub.js';
import { createLink, entryKind } from './linker.js';

/**
 * Real skill folders sitting inside tool directories (links are not strays).
 *
 * @param {{ id: string, label: string, path: string }[]} tools
 * @returns {{ tool: string, toolLabel: string, name: string, path: string }[]}
 */
export function findStrays(tools) {
  const found = [];
  for (const tool of tools) {
    let entries;
    try {
      entries = fs.readdirSync(tool.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(tool.path, entry.name);
      // A link is the desired state; a real directory is a stray.
      if (entryKind(full) !== 'dir') continue;
      if (!fs.existsSync(path.join(full, 'SKILL.md'))) continue;
      found.push({ tool: tool.id, toolLabel: tool.label, name: entry.name, path: full });
    }
  }
  return found;
}

/**
 * Move one stray into the hub, then replace it with a link.
 *
 * @param {string} hubDir
 * @param {{ tool: string, toolLabel: string, name: string, path: string }} stray
 * @param {{ dryRun?: boolean, overwrite?: boolean }} [options]
 * @returns {{ name: string, tool: string, action: string, tokens?: number }}
 */
export function adoptStray(hubDir, stray, options = {}) {
  if (entryKind(stray.path) !== 'dir') {
    throw new Error(`not a real folder: ${stray.path}`);
  }
  if (!fs.existsSync(path.join(stray.path, 'SKILL.md'))) {
    throw new Error(`no SKILL.md in ${stray.path}`);
  }

  if (options.dryRun) return { name: stray.name, tool: stray.tool, action: 'would-adopt' };

  const hubCopy = path.join(hubDir, stray.name);
  const before = measure(hubCopy);
  const installed = installFromDir(stray.path, hubDir, { overwrite: options.overwrite });
  const after = measure(hubCopy);

  // Verify the hub now holds a complete copy before anything is deleted.
  const source = measure(stray.path);
  const fresh = after.files !== before.files || after.bytes !== before.bytes;
  const complete = after.files === source.files && after.bytes === source.bytes;
  if (!complete || !fresh) {
    throw new Error(
      `hub copy is incomplete (${after.files}/${source.files} files) — original left untouched at ${stray.path}`,
    );
  }

  fs.rmSync(stray.path, { recursive: true, force: true });
  createLink(hubCopy, stray.path);
  return { name: stray.name, tool: stray.tool, action: installed.action };
}

/**
 * Adopt every stray found in the given tools.
 *
 * @param {string} hubDir
 * @param {{ id: string, label: string, path: string }[]} tools
 * @param {{ dryRun?: boolean, overwrite?: boolean }} [options]
 * @returns {{ adopted: { name: string, tool: string, action: string }[], failed: { stray: any, error: string }[] }}
 */
export function adoptAll(hubDir, tools, options = {}) {
  const adopted = [];
  const failed = [];
  for (const stray of findStrays(tools)) {
    try {
      adopted.push(adoptStray(hubDir, stray, options));
    } catch (error) {
      failed.push({ stray, error: error.message });
    }
  }
  return { adopted, failed };
}

/**
 * @param {string} dir
 * @returns {{ files: number, bytes: number }}
 */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir, { recursive: true });
  } catch {
    return { files: 0, bytes: 0 };
  }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      }
    } catch {
      /* vanished mid-walk */
    }
  }
  return { files, bytes };
}
