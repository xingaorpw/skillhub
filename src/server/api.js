/**
 * REST surface used by the web console and by scripts.
 *
 * Every mutating call returns the fresh state, so the UI never has to guess
 * what changed or issue a second round-trip.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  addToShelf,
  disableAll,
  disableSkills,
  enableAll,
  enableSkills,
  getState,
  gitInit,
  importFiles,
  installSource,
  linkAll,
  readSkill,
  removeSkill,
  resolveSkillDir,
  savePreferences,
  tierOf,
} from '../core/index.js';
import { countByAction } from '../core/plan.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{
 *   method: string,
 *   pathname: string,
 *   body: any,
 *   hubDir: string,
 *   allowOpen?: boolean
 * }} request
 * @returns {Promise<{ status: number, json: any }>}
 */
export async function handleApi({ method, pathname, body, hubDir, allowOpen = false }) {
  const route = `${method.toUpperCase()} ${pathname}`;

  if (route === 'GET /api/state') {
    return { status: 200, json: publicState(getState({ hubDir })) };
  }

  if (route === 'GET /api/plan') {
    const { plan } = linkAll({ hubDir, dryRun: true });
    return {
      status: 200,
      json: {
        counts: countByAction(plan.items),
        pending: plan.items.filter((item) => item.action === 'create' || item.action === 'remove'),
      },
    };
  }

  if (route === 'POST /api/reveal') {
    let target;
    try {
      target = revealTarget(hubDir, body?.skill ? String(body.skill) : null);
    } catch (error) {
      throw new ApiError(400, error.message);
    }
    const opened = allowOpen ? openInFileManager(target) : false;
    return { status: 200, json: { path: target, opened } };
  }

  const skillMatch = /^\/api\/skills\/([^/]+)(?:\/(enable|disable|remove))?$/.exec(pathname);
  if (skillMatch) {
    const name = decodeURIComponent(skillMatch[1]);
    const action = skillMatch[2];

    if (!action && method === 'GET') {
      const skill = readSkill(hubDir, name);
      return { status: 200, json: skill };
    }
    if (action === 'enable' && method === 'POST') {
      enableSkills(hubDir, [name]);
      linkAll({ hubDir });
      return { status: 200, json: publicState(getState({ hubDir })) };
    }
    if (action === 'disable' && method === 'POST') {
      disableSkills(hubDir, [name]);
      linkAll({ hubDir });
      return { status: 200, json: publicState(getState({ hubDir })) };
    }
    if (action === 'remove' && method === 'POST') {
      disableSkills(hubDir, [name]);
      linkAll({ hubDir });
      removeSkill(hubDir, name);
      linkAll({ hubDir });
      return { status: 200, json: publicState(getState({ hubDir })) };
    }
    throw new ApiError(405, `unsupported method for /api/skills/${name}`);
  }

  if (route === 'POST /api/link') {
    const dryRun = Boolean(body?.dryRun);
    const { plan, result } = linkAll({ hubDir, dryRun });
    return {
      status: 200,
      json: {
        dryRun,
        counts: countByAction(plan.items),
        created: result.created,
        removed: result.removed,
        failed: result.failed,
        state: dryRun ? undefined : publicState(getState({ hubDir })),
      },
    };
  }

  if (route === 'POST /api/install') {
    const source = String(body?.source ?? '').trim();
    if (!source) throw new ApiError(400, 'missing "source"');
    const result = await installSource(source, hubDir, { overwrite: Boolean(body?.overwrite) });
    addToShelf(hubDir, result.installed.map((item) => item.name));
    linkAll({ hubDir });
    return { status: 200, json: { ...result, state: publicState(getState({ hubDir })) } };
  }

  if (route === 'POST /api/shelf') {
    const mode = String(body?.mode ?? 'all');
    if (mode === 'all') enableAll(hubDir);
    else if (mode === 'none') disableAll(hubDir);
    else if (mode === 'shelf') {
      /* no-op: keep current shelf */
    } else throw new ApiError(400, `unknown shelf mode: ${mode}`);
    linkAll({ hubDir });
    return { status: 200, json: publicState(getState({ hubDir })) };
  }

  if (route === 'POST /api/preferences') {
    savePreferences(hubDir, {
      budget: body?.budget,
      dailyRequests: body?.dailyRequests,
    });
    return { status: 200, json: publicState(getState({ hubDir })) };
  }

  if (route === 'POST /api/git/init') {
    const result = gitInit(hubDir);
    return { status: 200, json: { ...result, state: publicState(getState({ hubDir })) } };
  }

  throw new ApiError(404, `no such endpoint: ${route}`);
}

/**
 * Handle a drag-and-drop upload: rebuild the tree in a temp dir, then install it
 * exactly like a cloned repository.
 *
 * @param {{ name: string | null, filename: string | null, data: Buffer }[]} parts
 * @param {string} hubDir
 * @returns {{ installed: { name: string, action: string }[], state: any }}
 */
export function importUpload(parts, hubDir) {
  const files = parts
    .filter((part) => part.name === 'files' && part.filename)
    .map((part) => ({ path: part.filename, data: part.data }));

  const overwritePart = parts.find((part) => part.name === 'overwrite');
  const overwrite = overwritePart ? overwritePart.data.toString('utf8').trim() === 'true' : false;

  if (files.length === 0) throw new ApiError(400, 'no files in the upload');

  const { installed } = importFiles(files, hubDir, { overwrite });
  addToShelf(hubDir, installed.map((item) => item.name));
  linkAll({ hubDir });
  return { installed, state: publicState(getState({ hubDir })) };
}

/**
 * Where "打开目录" should point: the hub itself, or one validated skill folder.
 *
 * @param {string} hubDir
 * @param {string | null} skill
 * @returns {string}
 */
export function revealTarget(hubDir, skill) {
  if (!skill) return path.resolve(hubDir);
  return resolveSkillDir(hubDir, skill);
}

/**
 * Hand a folder to the OS file manager. Fire and forget: `explorer.exe` exits
 * with 1 even on success, so we never look at the exit code.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function openInFileManager(target) {
  const command =
    process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(command, [target], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Trim the state for the wire: no absolute paths of individual skills, and only
 * the fields the console actually renders.
 *
 * @param {ReturnType<typeof getState>} state
 */
export function publicState(state) {
  const shelf = state.shelf;
  const onShelf = (name) => shelf === null || shelf.includes(name);

  return {
    hubDir: state.hubDir,
    exists: state.exists,
    platform: state.platform,
    version: pkg.version,
    shelf,
    stats: state.stats,
    budget: state.budget,
    dailyRequests: state.dailyRequests,
    projection: state.projection,
    savings: state.savings,
    spenders: state.spenders,
    tiers: state.tiers,
    git: state.git,
    tools: state.tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      path: tool.path,
      exists: tool.exists,
      links: tool.links,
    })),
    skills: state.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
      files: skill.files,
      bytes: skill.bytes,
      catalogTokens: skill.catalogTokens,
      bodyTokens: skill.bodyTokens,
      tier: tierOf(skill.catalogTokens).id,
      onShelf: onShelf(skill.name),
      updatedAt: skill.updatedAt,
      source: skill.source,
    })),
    sources: Object.values(state.config.sources ?? {}),
  };
}
