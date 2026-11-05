#!/usr/bin/env node
/**
 * End-to-end smoke test: the real CLI, the real server, the real MCP handshake.
 *
 * The unit tests cover the pieces; this script proves the pieces are wired
 * together the way a user experiences them, in a throwaway directory.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../src/server/http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'src', 'cli.js');
const FIXTURES = path.join(root, 'test', 'fixtures', 'repo');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-smoke-'));
const hub = path.join(work, 'hub');
const toolPath = path.join(work, 'tool', 'skills');

let passed = 0;
let server = null;

/**
 * @param {string} label
 * @param {() => any} fn
 */
async function step(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}\n    ${error.message}`);
    throw error;
  }
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--hub', hub], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`cli ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  console.log('\nskillhub smoke test\n');

  await step('init creates a hub', () => {
    cli(['init', hub]);
    assert.equal(fs.existsSync(path.join(hub, 'skillhub.json')), true);
  });

  await step('config can point at a custom tool directory', () => {
    const config = JSON.parse(fs.readFileSync(path.join(hub, 'skillhub.json'), 'utf8'));
    config.tools = [{ id: 'fake', label: 'Fake Tool', dir: toolPath, create: true }];
    fs.writeFileSync(path.join(hub, 'skillhub.json'), JSON.stringify(config, null, 2));
  });

  await step('add installs skills from a local folder', () => {
    cli(['add', FIXTURES]);
    const skills = fs.readdirSync(hub, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    assert.deepEqual(skills.map((entry) => entry.name).sort(), ['alpha', 'beta']);
  });

  await step('add links the shelf into the tool directory', () => {
    assert.equal(fs.lstatSync(path.join(toolPath, 'alpha')).isSymbolicLink(), true);
  });

  await step('list --json reports the catalog cost', () => {
    const parsed = JSON.parse(cli(['list', '--json']));
    assert.equal(parsed.skills.length, 2);
    assert.ok(parsed.stats.catalogTokens > 0);
  });

  await step('disable removes a link but keeps the skill', () => {
    cli(['disable', 'beta']);
    assert.equal(fs.existsSync(path.join(toolPath, 'beta')), false);
    assert.equal(fs.existsSync(path.join(hub, 'beta', 'SKILL.md')), true);
  });

  await step('doctor reports a clean plan', () => {
    const output = cli(['doctor']);
    assert.match(output, /hub exists/);
    assert.match(output, /plan is clean/);
  });

  await step('the server answers /api/state', async () => {
    server = await startServer({ hubDir: hub, port: 0, host: '127.0.0.1' });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state = await response.json();
    assert.equal(state.skills.length, 2);
    assert.equal(state.stats.onShelf, 1);
  });

  await step('the server serves the console', async () => {
    const { port } = server.address();
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /SkillHub/);
    const css = await fetch(`http://127.0.0.1:${port}/styles.css`);
    assert.equal(css.status, 200);
  });

  await step('the console can toggle a skill over HTTP', async () => {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/skills/beta/enable`, { method: 'POST' });
    const state = await response.json();
    assert.equal(state.stats.onShelf, 2);
    assert.equal(fs.existsSync(path.join(toolPath, 'beta')), true);
  });

  await step('MCP over HTTP answers initialize', async () => {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const json = await response.json();
    assert.equal(json.result.protocolVersion, '2024-11-05');
    assert.equal(json.result.serverInfo.name, 'skillhub');
  });

  await step('MCP over stdio completes a handshake and lists skills', async () => {
    const child = spawn(process.execPath, [CLI, 'mcp', '--hub', hub], { stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = [];
    let buffer = '';

    try {
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for MCP responses')), 10_000);
        child.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line) continue;
            responses.push(JSON.parse(line));
            if (responses.length === 2) {
              clearTimeout(timer);
              resolve();
            }
          }
        });
        child.on('error', reject);
      });

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);

      await done;
    } finally {
      child.kill();
    }

    assert.equal(responses[0].result.serverInfo.name, 'skillhub');
    const tools = responses[1].result.tools.map((tool) => tool.name);
    assert.ok(tools.includes('list_skills'));
    assert.ok(tools.includes('read_skill'));
  });

  await step('MCP tools/call reads a skill', async () => {
    const child = spawn(process.execPath, [CLI, 'mcp', '--hub', hub], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    try {
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 10_000);
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('"id":3')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_skill', arguments: { name: 'alpha' } } })}\n`,
      );
      await done;
    } finally {
      child.kill();
    }
    const response = JSON.parse(output.trim().split('\n').pop());
    assert.match(response.result.content[0].text, /# Alpha/);
  });

  console.log(`\n✓ ${passed} smoke checks passed\n`);
} catch (error) {
  process.exitCode = 1;
  console.error(`\n✗ smoke test failed: ${error.message}\n`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(work, { recursive: true, force: true });
}
