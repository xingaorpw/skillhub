/**
 * The web console's server: static files, JSON API, and an MCP endpoint that
 * lets a remote agent use the hub over plain HTTP.
 *
 * Bind to loopback by default. Binding to `0.0.0.0` (the "other devices" case)
 * requires a token, because the console can delete skills and rewrite links.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError, handleApi, importUpload, publicState } from './api.js';
import { parseMultipart } from './multipart.js';
import { getState } from '../core/index.js';
import { formatTokens } from '../core/tokens.js';
import { handleRpc } from '../mcp/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

/**
 * @param {{ hubDir: string, port?: number, host?: string, token?: string, open?: boolean }} options
 */
export async function startServer(options) {
  const { hubDir, port = 4711, host = '127.0.0.1' } = options;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const token = loopback ? null : options.token ?? process.env.SKILLHUB_TOKEN ?? crypto.randomBytes(16).toString('hex');

  const server = http.createServer((req, res) => {
    handleRequest(req, res, { hubDir, token }).catch((error) => {
      const status = error instanceof ApiError ? error.status : 500;
      sendJson(res, status, { error: error.message });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = /** @type {any} */ (server.address()).port;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`;
  const state = getState({ hubDir });

  console.log(`\n  skillhub ${color('2', 'console')}`);
  console.log(`  ${color('1', url)}`);
  console.log(`  hub      ${hubDir}`);
  console.log(`  skills   ${state.skills.length} (${state.stats.onShelf} on the shelf, ≈${formatTokens(state.stats.visibleTokens)} tokens visible)`);
  console.log(`  tools    ${state.tools.map((tool) => tool.label).join(', ') || 'none detected'}`);
  if (token) {
    console.log(`  ${color('33', 'token')}    ${token}`);
    console.log(color('2', '           (required for writes; pass ?token=… or x-skillhub-token)'));
  }
  console.log(color('2', '\n  ctrl+c to stop\n'));

  if (options.open) openBrowser(url);
  return server;
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ hubDir: string, token: string | null }} context
 */
async function handleRequest(req, res, context) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (pathname === '/mcp' && method === 'POST') {
    const body = await readJson(req);
    const result = await handleRpc(body, { hubDir: context.hubDir });
    sendJson(res, 200, result ?? {});
    return;
  }

  if (pathname === '/api/import' && method === 'POST') {
    if (!authorized(req, url, context.token)) {
      sendJson(res, 401, { error: 'missing or invalid token' });
      return;
    }
    const buffer = await readBody(req, 32 * 1024 * 1024);
    const parts = parseMultipart(buffer, String(req.headers['content-type'] ?? ''));
    const result = importUpload(parts, context.hubDir);
    sendJson(res, 200, result);
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (method !== 'GET' && !authorized(req, url, context.token)) {
      sendJson(res, 401, { error: 'missing or invalid token' });
      return;
    }
    const body = method === 'GET' ? null : await readJson(req);
    const { status, json } = await handleApi({ method, pathname, body, hubDir: context.hubDir });
    sendJson(res, status, json);
    return;
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendFile(res, path.join(WEB_ROOT, 'index.html'));
    return;
  }

  if (method === 'GET') {
    const candidate = path.resolve(WEB_ROOT, `.${pathname}`);
    if (!candidate.startsWith(WEB_ROOT + path.sep)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      sendFile(res, candidate);
      return;
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

/**
 * @param {http.IncomingMessage} req
 * @param {URL} url
 * @param {string | null} token
 */
function authorized(req, url, token) {
  if (!token) return true;
  const header = req.headers['x-skillhub-token'];
  const provided = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get('token');
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * @param {http.IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, `request body too large (limit ${Math.round(limit / 1024 / 1024)} MB)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new ApiError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {string} file
 */
function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(body);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {any} json
 */
function sendJson(res, status, json) {
  const body = Buffer.from(JSON.stringify(json));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...corsHeaders(),
  });
  res.end(body);
}

/**
 * The console is served from the same origin, so CORS only matters for the MCP
 * endpoint being called from a browser-based agent.
 *
 * @param {http.IncomingMessage} [req]
 */
function corsHeaders(req) {
  const origin = req?.headers?.origin ?? '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-skillhub-token',
  };
}

/**
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* opening a browser is a nicety, never a failure */
  }
}

/**
 * @param {string} code
 * @param {string} text
 */
function color(code, text) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export { publicState };
