/**
 * REST surface used by the web console and by scripts.
 *
 * Every mutating call returns the fresh state, so the UI never has to guess
 * what changed or issue a second round-trip.
 */

import {
  disableSkills,
  enableAll,
  enableSkills,
  getState,
  installSource,
  linkAll,
  readSkill,
  removeSkill,
} from '../core/index.js';
import { countByAction } from '../core/plan.js';

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
 *   hubDir: string
 * }} request
 * @returns {Promise<{ status: number, json: any }>}
 */
export async function handleApi({ method, pathname, body, hubDir }) {
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
    linkAll({ hubDir });
    return { status: 200, json: { ...result, state: publicState(getState({ hubDir })) } };
  }

  if (route === 'POST /api/shelf') {
    const mode = String(body?.mode ?? 'all');
    if (mode === 'all') enableAll(hubDir);
    else if (mode === 'shelf') {
      /* no-op: keep current shelf */
    } else throw new ApiError(400, `unknown shelf mode: ${mode}`);
    linkAll({ hubDir });
    return { status: 200, json: publicState(getState({ hubDir })) };
  }

  throw new ApiError(404, `no such endpoint: ${route}`);
}

/**
 * Trim the state for the wire: no absolute paths of individual skills, and only
 * the fields the console actually renders.
 *
 * @param {ReturnType<typeof getState>} state
 */
export function publicState(state) {
  return {
    hubDir: state.hubDir,
    exists: state.exists,
    platform: state.platform,
    shelf: state.shelf,
    stats: state.stats,
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
      updatedAt: skill.updatedAt,
      source: skill.source,
    })),
    sources: Object.values(state.config.sources ?? {}),
  };
}
