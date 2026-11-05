/**
 * MCP server (Model Context Protocol, 2024-11-05).
 *
 * This is the piece that makes the hub reachable from *any* device: an agent on
 * another machine points its MCP client at `skillhub mcp` over stdio, or at
 * `POST /mcp` on a running console, and can then list, read, enable and install
 * the very same skills the local tools see.
 *
 * Transport is newline-delimited JSON-RPC 2.0, which is what the stdio
 * transport specifies; the HTTP endpoint reuses the same handler for a single
 * request/response exchange.
 */

import { createInterface } from 'node:readline';

import {
  disableSkills,
  enableSkills,
  getState,
  installSource,
  linkAll,
  listSkills,
  readSkill,
} from '../core/index.js';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = { name: 'skillhub', version: '0.1.0' };

const TOOLS = [
  {
    name: 'list_skills',
    description:
      'List every skill in the hub with its description, catalog token cost and whether it is currently on the shelf (visible to agents).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_skill',
    description: 'Return the full SKILL.md of one skill so you can follow its instructions.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name as returned by list_skills' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'enable_skill',
    description: 'Put a skill on the shelf: it becomes visible to every AI tool on this machine.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'disable_skill',
    description: 'Take a skill off the shelf (it stays installed) to shrink the catalog the model sees.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'install_skill',
    description: 'Install skills from a GitHub repository (owner/repo, URL) or a local folder into the hub.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'owner/repo, https://github.com/owner/repo[/tree/ref/sub], or a local path' },
        overwrite: { type: 'boolean', description: 'Replace skills that already exist' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'link_tools',
    description: 'Re-apply the hub → tool links (idempotent). Use after changing the shelf by hand.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/**
 * @param {any} message
 * @param {{ hubDir: string }} context
 * @returns {Promise<any | null>}
 */
export async function handleRpc(message, context) {
  if (!message || typeof message !== 'object') {
    return errorResponse(null, -32600, 'invalid request');
  }
  if (Array.isArray(message)) {
    const results = await Promise.all(message.map((entry) => handleRpc(entry, context)));
    return results.filter(Boolean);
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  try {
    const result = await dispatch(method, params, context);
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    if (isNotification) return null;
    return errorResponse(id, -32000, /** @type {Error} */ (error).message);
  }
}

/**
 * @param {string} method
 * @param {any} params
 * @param {{ hubDir: string }} context
 */
async function dispatch(method, params, context) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'SkillHub exposes a shared library of agent skills. Use list_skills, then read_skill to load the instructions you need.',
      };

    case 'ping':
      return {};

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return callTool(params, context);

    case 'resources/list': {
      const skills = listSkills(context.hubDir);
      return {
        resources: skills.map((skill) => ({
          uri: `skill://${skill.name}`,
          name: skill.name,
          description: skill.description,
          mimeType: 'text/markdown',
        })),
      };
    }

    case 'resources/read': {
      const uri = String(params?.uri ?? '');
      const name = uri.replace(/^skill:\/\//, '');
      const skill = readSkill(context.hubDir, name);
      return { contents: [{ uri, mimeType: 'text/markdown', text: skill.markdown }] };
    }

    case 'prompts/list':
      return { prompts: [] };

    default:
      throw new Error(`method not found: ${method}`);
  }
}

/**
 * @param {{ name: string, arguments?: any }} params
 * @param {{ hubDir: string }} context
 */
async function callTool(params, context) {
  const name = params?.name;
  const args = params?.arguments ?? {};

  switch (name) {
    case 'list_skills': {
      const state = getState({ hubDir: context.hubDir });
      const shelf = state.shelf;
      const payload = state.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        catalogTokens: skill.catalogTokens,
        onShelf: shelf === null || shelf.includes(skill.name),
        slashOnly: skill.disableModelInvocation,
      }));
      return textResult(JSON.stringify({ hubDir: state.hubDir, stats: state.stats, skills: payload }, null, 2));
    }

    case 'read_skill': {
      const skill = readSkill(context.hubDir, String(args.name ?? ''));
      return textResult(skill.markdown);
    }

    case 'enable_skill': {
      const result = enableSkills(context.hubDir, [String(args.name ?? '')]);
      const link = linkAll({ hubDir: context.hubDir });
      return textResult(
        `enabled ${result.changed.join(', ') || '(nothing)'}; shelf now holds ${result.shelf.length} skills; ` +
          `${link.result.created} links created`,
      );
    }

    case 'disable_skill': {
      const result = disableSkills(context.hubDir, [String(args.name ?? '')]);
      const link = linkAll({ hubDir: context.hubDir });
      return textResult(
        `disabled ${result.changed.join(', ') || '(nothing)'}; shelf now holds ${result.shelf.length} skills; ` +
          `${link.result.removed} links removed`,
      );
    }

    case 'install_skill': {
      const result = await installSource(String(args.source ?? ''), context.hubDir, {
        overwrite: Boolean(args.overwrite),
      });
      linkAll({ hubDir: context.hubDir });
      const lines = result.installed.map((item) => `${item.action}: ${item.name}`);
      return textResult(`installed from ${result.source}\n${lines.join('\n')}`);
    }

    case 'link_tools': {
      const { result } = linkAll({ hubDir: context.hubDir });
      return textResult(`links applied: ${result.created} created, ${result.removed} removed, ${result.failed.length} failed`);
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/**
 * @param {string} text
 */
function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

/**
 * @param {any} id
 * @param {number} code
 * @param {string} message
 */
function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Run the stdio transport until stdin closes.
 *
 * @param {{ hubDir: string }} options
 */
export async function startMcpServer(options) {
  const context = { hubDir: options.hubDir };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  process.stderr.write(`skillhub mcp ready (hub: ${context.hubDir})\n`);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify(errorResponse(null, -32700, 'parse error'))}\n`);
      continue;
    }

    const response = await handleRpc(message, context);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
