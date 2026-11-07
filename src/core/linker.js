/**
 * Directory linking — the mechanism that lets one hub folder serve every tool.
 *
 * Rules that keep this safe:
 *  1. Only ever *create* links; never copy or move a skill into a tool folder.
 *  2. Only ever *remove* something that `lstat` reports as a link. A real
 *     directory is never touched, because `fs.rm({recursive:true})` on a
 *     junction follows it and deletes the hub's contents (a real bug in
 *     PowerShell 5.1's `Remove-Item -Recurse`, and in plenty of other tools).
 *  3. Prefer junctions on Windows: they need no Administrator rights and no
 *     Developer Mode, unlike symlinks.
 */

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {'missing' | 'link' | 'dir' | 'file' | 'other'} EntryKind */

/**
 * @param {string} p
 * @returns {EntryKind}
 */
export function entryKind(p) {
  let stat;
  try {
    stat = fs.lstatSync(p);
  } catch {
    return 'missing';
  }
  if (stat.isSymbolicLink()) return 'link';
  if (stat.isDirectory()) return 'dir';
  if (stat.isFile()) return 'file';
  return 'other';
}

/**
 * @param {string} p
 * @returns {string | null} absolute target of a link, or null
 */
export function linkTarget(p) {
  try {
    const target = fs.readlinkSync(p);
    return path.resolve(path.dirname(p), target);
  } catch {
    return null;
  }
}

/**
 * @param {string} linkPath
 * @param {string} hubDir
 * @returns {boolean}
 */
export function isLinkedInto(linkPath, hubDir) {
  const target = linkTarget(linkPath);
  if (!target) return false;
  const hub = path.resolve(hubDir);
  return target === hub || target.startsWith(hub + path.sep);
}

/**
 * True when the link's *final* destination is inside the hub.
 *
 * A link can point at another tool folder that itself links into the hub (a
 * chain). It works today but breaks the moment the middle folder goes away, so
 * `inspectLink` reports that case separately.
 *
 * @param {string} linkPath
 * @param {string} hubDir
 * @returns {boolean}
 */
export function resolvesInto(linkPath, hubDir) {
  let real;
  try {
    real = fs.realpathSync(linkPath);
  } catch {
    return false;
  }
  const hub = path.resolve(hubDir);
  return real === hub || real.startsWith(hub + path.sep);
}

/**
 * Create a directory link. On Windows this is a junction, which requires no
 * elevation; elsewhere it is a plain symlink.
 *
 * @param {string} target absolute path that must already exist
 * @param {string} linkPath path to create
 */
export function createLink(target, linkPath) {
  const absoluteTarget = path.resolve(target);
  if (entryKind(absoluteTarget) === 'missing') {
    throw new Error(`link target does not exist: ${absoluteTarget}`);
  }
  if (entryKind(linkPath) !== 'missing') {
    throw new Error(`refusing to overwrite existing path: ${linkPath}`);
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(absoluteTarget, linkPath, type);
}

/**
 * Remove a link, leaving its target untouched. Refuses anything that is not a
 * link, which is the guard that makes "sync" safe to run repeatedly.
 *
 * @param {string} linkPath
 * @returns {boolean} whether something was removed
 */
export function removeLink(linkPath) {
  if (entryKind(linkPath) === 'missing') return false;
  if (entryKind(linkPath) !== 'link') {
    throw new Error(`refusing to remove a real path (not a link): ${linkPath}`);
  }
  if (process.platform === 'win32') {
    // A junction is a reparse point: rmdir removes the point, not the contents.
    try {
      fs.rmdirSync(linkPath);
      return true;
    } catch {
      fs.unlinkSync(linkPath);
      return true;
    }
  }
  fs.unlinkSync(linkPath);
  return true;
}

/**
 * Describe what a tool folder currently holds for one skill.
 *
 * @param {string} linkPath
 * @param {string} hubDir
 * @returns {{ state: 'missing' | 'linked' | 'linked-elsewhere' | 'blocked', target: string | null }}
 */
export function inspectLink(linkPath, hubDir) {
  const kind = entryKind(linkPath);
  if (kind === 'missing') return { state: 'missing', target: null };
  if (kind === 'link') {
    if (isLinkedInto(linkPath, hubDir)) return { state: 'linked', target: linkTarget(linkPath) };
    // Points somewhere else, but that "somewhere" is itself the hub: a chain.
    if (resolvesInto(linkPath, hubDir)) return { state: 'chained', target: linkTarget(linkPath) };
    return { state: 'linked-elsewhere', target: linkTarget(linkPath) };
  }
  // A real folder with the same name: someone installed it manually. Never
  // destroy it silently — report it and let the user decide.
  return { state: 'blocked', target: null };
}
