#!/usr/bin/env node
/**
 * skillhub — one skill hub for every AI tool on every device.
 *
 * The CLI is intentionally dependency-free: it has to run on a fresh machine
 * where `npm install` is blocked, so every command is plain Node.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_NAME,
  DEFAULT_HUB,
  addToShelf,
  buildPlan,
  countByAction,
  detectTools,
  disableSkills,
  enableAll,
  enableSkills,
  ensureHub,
  getState,
  gitInit,
  gitStatus,
  installSource,
  linkAll,
  listSkills,
  loadConfig,
  platformLabel,
  readSkill,
  removeSkill,
  resolveHubDir,
  saveConfig,
  savePreferences,
  summarize,
} from './core/index.js';
import { formatTokens } from './core/tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const color = createPalette();

main(process.argv.slice(2)).catch((error) => {
  console.error(`\n${color.red('error')} ${error.message}`);
  if (process.env.SKILLHUB_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const [command = 'help', ...rest] = positional;

  if (flags.version || command === 'version') return printVersion();
  if (flags.help || command === 'help' || command === '--help') return printHelp();

  const hubDir = resolveHubDir(flags.hub);

  switch (command) {
    case 'init':
      return cmdInit(hubDir, rest, flags);
    case 'add':
    case 'install':
      return cmdAdd(hubDir, rest, flags);
    case 'list':
    case 'ls':
      return cmdList(hubDir, flags);
    case 'enable':
    case 'on':
      return cmdEnable(hubDir, rest, flags);
    case 'disable':
    case 'off':
      return cmdDisable(hubDir, rest, flags);
    case 'link':
      return cmdLink(hubDir, flags);
    case 'unlink':
      return cmdUnlink(hubDir, rest, flags);
    case 'remove':
    case 'rm':
      return cmdRemove(hubDir, rest, flags);
    case 'show':
    case 'cat':
      return cmdShow(hubDir, rest, flags);
    case 'serve':
    case 'ui':
      return cmdServe(hubDir, flags);
    case 'mcp':
      return cmdMcp(hubDir, flags);
    case 'git':
      return cmdGit(hubDir, rest, flags);
    case 'config':
      return cmdConfig(hubDir, rest, flags);
    case 'doctor':
      return cmdDoctor(hubDir, flags);
    default:
      console.error(`${color.red('unknown command')} ${command}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ commands

/**
 * @param {string} hubDir
 * @param {string[]} args
 * @param {Record<string, any>} flags
 */
function cmdInit(hubDir, args, flags) {
  const target = args[0] ? path.resolve(args[0]) : hubDir;
  const { created } = ensureHub(target);
  const config = loadConfig(target);
  if (flags.tools) {
    const wanted = String(flags.tools).split(',').map((s) => s.trim()).filter(Boolean);
    config.tools = detectTools().filter((tool) => wanted.includes(tool.id)).map((tool) => ({ id: tool.id, dir: tool.dir }));
    saveConfig(target, config);
  }

  const state = getState({ hubDir: target });
  console.log(`${color.green(created ? '✓ created' : '✓ ready')} hub at ${color.bold(target)}`);
  console.log(`  config   ${CONFIG_NAME}`);
  console.log(`  skills   ${state.skills.length}`);
  console.log(`  tools    ${state.tools.map((tool) => tool.label).join(', ') || '(none detected)'}`);
  console.log(`\nnext: ${color.cyan('skillhub add mattpocock/skills')}  then  ${color.cyan('skillhub serve')}`);
}

/**
 * @param {string} hubDir
 * @param {string[]} sources
 * @param {Record<string, any>} flags
 */
async function cmdAdd(hubDir, sources, flags) {
  if (!sources.length) throw new Error('usage: skillhub add <owner/repo | github url | local path> [...]');
  ensureHub(hubDir);

  const config = loadConfig(hubDir);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const names = [];

  for (const source of sources) {
    console.log(`${color.bold('→')} ${source}`);
    const result = await installSource(source, hubDir, {
      overwrite: Boolean(flags.overwrite ?? flags.force),
      log: (line) => console.log(`  ${color.dim(line)}`),
    });

    for (const item of result.installed) {
      names.push(item.name);
      if (item.action === 'added') added += 1;
      else if (item.action === 'updated') updated += 1;
      else skipped += 1;
    }

    config.sources[result.source] = {
      source: result.source,
      ref: result.ref,
      installedAt: new Date().toISOString(),
      skills: result.installed.map((item) => item.name),
    };
  }
  saveConfig(hubDir, config);
  addToShelf(hubDir, names);

  console.log(`\n${color.green('✓')} added ${added}, updated ${updated}, skipped ${skipped}`);
  if (!flags['no-link']) relink(hubDir, flags);
}

/**
 * @param {string} hubDir
 * @param {Record<string, any>} flags
 */
function cmdList(hubDir, flags) {
  const state = getState({ hubDir });
  const shelf = state.shelf;
  const rows = state.skills;

  if (flags.json) {
    console.log(JSON.stringify({ hubDir: state.hubDir, shelf, skills: rows, stats: state.stats }, null, 2));
    return;
  }

  if (!rows.length) {
    console.log(`${color.dim('no skills yet')} — try: skillhub add mattpocock/skills`);
    return;
  }

  const onShelf = (name) => shelf === null || shelf.includes(name);
  const nameWidth = Math.min(38, Math.max(...rows.map((row) => row.name.length), 4));
  const stats = summarize(rows, shelf);

  console.log(
    `${color.dim(pad('skill', nameWidth))}  ${color.dim(pad('tokens', 7))}  ${color.dim(pad('shelf', 5))}  ${color.dim('description')}`,
  );
  for (const skill of rows) {
    const on = onShelf(skill.name);
    const marker = on ? color.green('on ') : color.dim('off');
    const tag = skill.disableModelInvocation ? color.dim(' /cmd') : '';
    console.log(
      `${pad(skill.name, nameWidth)}  ${pad(String(skill.catalogTokens), 7)}  ${marker}    ${truncate(skill.description || color.dim('(no description)'), 72)}${tag}`,
    );
  }

  console.log(
    `\n${rows.length} skills · ${stats.onShelf} on the shelf · catalog cost ${color.bold(`≈${formatTokens(stats.visibleTokens)} tokens`)}` +
      (shelf === null ? '' : ` of ≈${formatTokens(stats.catalogTokens)} total`),
  );
  console.log(color.dim(`hub: ${state.hubDir}`));
}

/**
 * @param {string} hubDir
 * @param {string[]} names
 * @param {Record<string, any>} flags
 */
function cmdEnable(hubDir, names, flags) {
  if (names.includes('--all') || flags.all) {
    enableAll(hubDir);
    console.log(`${color.green('✓')} every skill is on the shelf (catalog cost goes up)`);
    return relink(hubDir, flags);
  }
  if (!names.length) throw new Error('usage: skillhub enable <skill> [...] | --all');
  const result = enableSkills(hubDir, names);
  console.log(`${color.green('✓')} enabled ${result.changed.length}: ${result.changed.join(', ') || '(none)'}`);
  console.log(color.dim(`shelf now holds ${result.shelf.length} skills`));
  relink(hubDir, flags);
}

/**
 * @param {string} hubDir
 * @param {string[]} names
 * @param {Record<string, any>} flags
 */
function cmdDisable(hubDir, names, flags) {
  if (!names.length) throw new Error('usage: skillhub disable <skill> [...]');
  const result = disableSkills(hubDir, names);
  console.log(`${color.green('✓')} disabled ${result.changed.length}: ${result.changed.join(', ') || '(none)'}`);
  console.log(color.dim('skills stay in the hub; only their links are removed'));
  relink(hubDir, flags);
}

/**
 * @param {string} hubDir
 * @param {Record<string, any>} flags
 */
function cmdLink(hubDir, flags) {
  relink(hubDir, flags);
}

/**
 * @param {string} hubDir
 * @param {string[]} names
 * @param {Record<string, any>} flags
 */
function cmdUnlink(hubDir, names, flags) {
  if (!names.length) throw new Error('usage: skillhub unlink <skill> [...]');
  const state = getState({ hubDir });
  const config = loadConfig(hubDir);
  const all = state.skills.map((skill) => skill.name);
  const current = config.shelf ?? all;
  config.shelf = all.filter((name) => current.includes(name) && !names.includes(name));
  saveConfig(hubDir, config);
  console.log(`${color.green('✓')} unlinked ${names.join(', ')} (still in the hub)`);
  relink(hubDir, flags);
}

/**
 * @param {string} hubDir
 * @param {string[]} names
 * @param {Record<string, any>} flags
 */
function cmdRemove(hubDir, names, flags) {
  if (!names.length) throw new Error('usage: skillhub remove <skill> [...]');
  const state = getState({ hubDir });
  for (const name of names) {
    // Drop the links first so nothing points at a deleted folder.
    disableSkills(hubDir, [name]);
    removeSkill(hubDir, name);
    console.log(`${color.green('✓')} removed ${name}`);
  }
  relink(hubDir, flags);
  console.log(color.dim(`${state.skills.length - names.length} skills left`));
}

/**
 * @param {string} hubDir
 * @param {string[]} args
 * @param {Record<string, any>} flags
 */
function cmdShow(hubDir, args, flags) {
  if (!args.length) throw new Error('usage: skillhub show <skill>');
  const skill = readSkill(hubDir, args[0]);
  if (flags.json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }
  console.log(color.bold(skill.name));
  console.log(color.dim(skill.path));
  console.log('');
  console.log(skill.markdown);
}

/**
 * @param {string} hubDir
 * @param {Record<string, any>} flags
 */
async function cmdServe(hubDir, flags) {
  const { startServer } = await import('./server/http.js');
  const port = Number(flags.port ?? process.env.SKILLHUB_PORT ?? 4711);
  const host = String(flags.host ?? '127.0.0.1');

  // An empty hub looks like a broken console, so say it out loud before serving.
  const skills = listSkills(hubDir);
  if (skills.length === 0) {
    console.log(`${color.yellow('!')} no skills found in ${hubDir}`);
    console.log(color.dim('  if your skills live elsewhere, point at them: skillhub serve --hub <dir>'));
    console.log(color.dim('  or install one first: skillhub add owner/repo'));
    console.log('');
  }

  await startServer({ hubDir, port, host, open: Boolean(flags.open) });
}

/**
 * @param {string} hubDir
 */
async function cmdMcp(hubDir) {
  const { startMcpServer } = await import('./mcp/server.js');
  await startMcpServer({ hubDir });
}

/**
 * `skillhub git [init|status]` — turn the hub into a repository and show what to
 * do next. Never pushes, never adds a remote: that stays a human decision.
 *
 * @param {string} hubDir
 * @param {string[]} args
 */
function cmdGit(hubDir, args) {
  const sub = args[0] ?? 'status';

  if (sub === 'init') {
    const result = gitInit(hubDir);
    if (result.ok) {
      console.log(`${color.green('✓')} git repository ready${result.committed ? ' (initial commit created)' : ''}`);
    } else {
      console.log(`${color.yellow('!')} ${result.reason}`);
    }
    if (result.gitignore) console.log(color.dim('  wrote .gitignore'));
    console.log(`\n${color.bold('next')}`);
    for (const command of result.next) console.log(`  ${command}`);
    return;
  }

  const status = gitStatus(hubDir);
  if (!status.isRepo) {
    console.log(`${color.yellow('!')} not a git repository — run: ${color.cyan('skillhub git init')}`);
    return;
  }

  console.log(`${color.green('✓')} repository   ${hubDir}`);
  console.log(`  branch     ${status.branch ?? '?'}`);
  console.log(`  remote     ${status.remote ?? color.dim('(none)')}`);
  console.log(`  commits    ${status.commits ?? '?'}`);
  console.log(`  changes    ${status.dirty === null ? color.dim('(git not installed)') : status.dirty}`);
  if (!status.remote) console.log(color.dim('\n  add one: git remote add origin git@github.com:<you>/my-skills.git'));
}

/**
 * `skillhub config <budget|requests> <value>` — the two knobs behind the cost
 * projection.
 *
 * @param {string} hubDir
 * @param {string[]} args
 */
function cmdConfig(hubDir, args) {
  const [key, raw] = args;
  if (!key || raw === undefined) {
    const config = loadConfig(hubDir);
    console.log(`budget    ${config.budget ?? color.dim('(default 2000)')}`);
    console.log(`requests  ${config.dailyRequests ?? color.dim('(default 100)')}`);
    return;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`not a positive number: ${raw}`);

  if (key === 'budget') savePreferences(hubDir, { budget: value });
  else if (key === 'requests') savePreferences(hubDir, { dailyRequests: value });
  else throw new Error(`unknown setting: ${key} (use budget or requests)`);

  console.log(`${color.green('✓')} ${key} = ${value}`);
}

/**
 * @param {string} hubDir
 */
function cmdDoctor(hubDir) {
  const checks = [];
  const state = getState({ hubDir });

  checks.push({
    ok: Number(process.versions.node.split('.')[0]) >= 18,
    label: 'node >= 18',
    detail: platformLabel(),
  });
  checks.push({
    ok: fs.existsSync(hubDir),
    label: 'hub exists',
    detail: hubDir,
  });
  checks.push({
    ok: state.tools.length > 0,
    label: 'tools detected',
    detail: state.tools.map((tool) => `${tool.id}${tool.exists ? '' : ' (missing dir)'}`).join(', ') || 'none',
  });

  let broken = 0;
  let blocked = 0;
  for (const tool of state.tools) {
    for (const skill of state.skills) {
      const linkPath = path.join(tool.path, skill.name);
      let stat;
      try {
        stat = fs.lstatSync(linkPath);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink()) {
        blocked += 1;
        continue;
      }
      const target = fs.readlinkSync(linkPath);
      if (!fs.existsSync(path.resolve(path.dirname(linkPath), target))) broken += 1;
    }
  }

  checks.push({ ok: broken === 0, label: 'no broken links', detail: `${broken} broken` });
  checks.push({ ok: true, label: 'real folders in tool dirs', detail: `${blocked} (left untouched)` });

  const plan = buildPlan({ hubDir, skills: state.skills, tools: state.tools, shelf: state.shelf });
  const counts = countByAction(plan.items);
  checks.push({
    ok: (counts.blocked ?? 0) === 0,
    label: 'plan is clean',
    detail: `create=${counts.create ?? 0} remove=${counts.remove ?? 0} blocked=${counts.blocked ?? 0} foreign=${counts.foreign ?? 0}`,
  });

  for (const check of checks) {
    const mark = check.ok ? color.green('✓') : color.red('✗');
    console.log(`${mark} ${pad(check.label, 26)} ${color.dim(check.detail)}`);
  }

  console.log('');
  console.log(`hub      ${state.hubDir}`);
  console.log(`skills   ${state.skills.length} (${state.stats.onShelf} on the shelf)`);
  console.log(`catalog  ≈${formatTokens(state.stats.visibleTokens)} tokens visible`);
}

// ------------------------------------------------------------------ helpers

/**
 * @param {string} hubDir
 * @param {Record<string, any>} flags
 */
function relink(hubDir, flags) {
  const dryRun = Boolean(flags['dry-run'] ?? flags.dryRun);
  const tools = flags.tool ? String(flags.tool).split(',').map((s) => s.trim()) : undefined;

  if (!fs.existsSync(hubDir)) {
    console.log(color.dim('no hub yet — run: skillhub init'));
    return;
  }

  const { plan, result } = linkAll({ hubDir, dryRun, tools });
  const counts = countByAction(plan.items);

  for (const item of plan.items) {
    if (item.action === 'create' || item.action === 'remove') {
      const verb = item.action === 'create' ? color.green('+') : color.yellow('-');
      if (flags.verbose) console.log(`  ${verb} ${item.toolLabel}/${item.skill}`);
    }
  }
  for (const item of plan.items) {
    if (item.action === 'blocked' || item.action === 'foreign') {
      console.log(`  ${color.yellow('!')} ${item.toolLabel}/${item.skill}: ${item.detail}`);
    }
  }

  const prefix = dryRun ? color.dim('[dry-run] ') : '';
  console.log(
    `${prefix}${color.green('✓')} links: ${result.created} created, ${result.removed} removed, ` +
      `${counts.ok ?? 0} unchanged, ${counts.blocked ?? 0} blocked`,
  );
  if (result.failed.length) {
    for (const failure of result.failed) console.log(`  ${color.red('✗')} ${failure.item.tool}/${failure.item.skill}: ${failure.error}`);
  }
}

/**
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: Record<string, any> }}
 */
function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, any>} */
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (inline !== undefined) {
        flags[key] = inline;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[key] = argv[i + 1];
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '-v') {
      flags.version = true;
      continue;
    }
    if (arg === '-a') {
      flags.all = true;
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function printVersion() {
  console.log(pkg.version);
}

function printHelp() {
  console.log(`
${color.bold('skillhub')} ${color.dim(`v${pkg.version}`)} — one skill hub for every AI tool

${color.bold('USAGE')}
  skillhub <command> [options]

${color.bold('COMMANDS')}
  init [dir]              create a hub (default: ${DEFAULT_HUB})
  add <source...>         install skills from GitHub or a local folder
  list                    show skills, catalog cost and shelf state
  enable <skill...>       put skills on the shelf (and link them)
  disable <skill...>      take skills off the shelf (they stay in the hub)
  link                    (re)apply links for every detected tool
  unlink <skill...>       remove links for specific skills
  remove <skill...>       delete skills from the hub
  show <skill>            print a skill's SKILL.md
  serve                   open the web console (default http://127.0.0.1:4711)
  mcp                     run as an MCP server over stdio
  git [init|status]       turn the hub into a repository / show its state
  config <key> [value]    read or set budget and daily requests
  doctor                  diagnose the hub, tools and links

${color.bold('OPTIONS')}
  --hub <dir>             hub location (or $SKILLHUB_HOME)
  --tool <id,id>          limit to specific tools (dsh, claude, codex, cursor, ...)
  --dry-run               print the plan without touching anything
  --overwrite             replace skills that already exist
  --no-link               skip linking after add
  --json                  machine-readable output
  --verbose               per-link output
  --version, --help

${color.bold('EXAMPLES')}
  skillhub init ~/skills && cd ~/skills
  skillhub add mattpocock/skills
  skillhub disable $(skillhub list --json | node -e "…")   # or just: skillhub disable suno-cn-music
  skillhub serve --port 4711
  skillhub mcp          # add to Claude Code / Codex / Cursor as an MCP server

${color.dim('docs: docs/architecture.md · docs/tools.md · docs/sync-across-devices.md')}
`);
}

/**
 * @param {string} value
 * @param {number} width
 */
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * @param {string} value
 * @param {number} width
 */
function truncate(value, width) {
  const text = String(value).replace(/\s+/g, ' ');
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function createPalette() {
  const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
  };
}
