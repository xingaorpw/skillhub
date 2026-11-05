import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMultipart } from '../src/server/multipart.js';

const BOUNDARY = '----skillhub-test-boundary';

/**
 * @param {{ name: string, filename?: string, type?: string, body: string | Buffer }[]} parts
 * @returns {Buffer}
 */
function buildBody(parts) {
  const chunks = [];
  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n`));
    if (part.type) chunks.push(Buffer.from(`Content-Type: ${part.type}\r\n`));
    chunks.push(Buffer.from('\r\n'));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body, 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

test('parses a file part and a plain field', () => {
  const body = buildBody([
    { name: 'files', filename: 'my-skill/SKILL.md', type: 'text/markdown', body: '# Hello\n' },
    { name: 'overwrite', body: 'true' },
  ]);

  const parts = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, 'files');
  assert.equal(parts[0].filename, 'my-skill/SKILL.md');
  assert.equal(parts[0].contentType, 'text/markdown');
  assert.equal(parts[0].data.toString('utf8'), '# Hello\n');
  assert.equal(parts[1].name, 'overwrite');
  assert.equal(parts[1].filename, null);
  assert.equal(parts[1].data.toString('utf8'), 'true');
});

test('accepts a quoted boundary', () => {
  const body = buildBody([{ name: 'files', filename: 'a/SKILL.md', body: 'x' }]);
  const parts = parseMultipart(body, `multipart/form-data; boundary="${BOUNDARY}"`);
  assert.equal(parts.length, 1);
});

test('keeps binary bytes intact', () => {
  const binary = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x1a, 0x80]);
  const body = buildBody([{ name: 'files', filename: 'a/logo.bin', body: binary }]);

  const parts = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
  assert.deepEqual(parts[0].data, binary);
});

test('preserves CRLF inside the payload', () => {
  const text = 'line1\r\nline2\r\nline3';
  const body = buildBody([{ name: 'files', filename: 'a/SKILL.md', body: text }]);
  const parts = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
  assert.equal(parts[0].data.toString('utf8'), text);
});

test('rejects a body without a boundary parameter', () => {
  assert.throws(() => parseMultipart(Buffer.from('x'), 'multipart/form-data'), /boundary/);
});

test('rejects a boundary that is not in the body', () => {
  assert.throws(
    () => parseMultipart(Buffer.from('nothing here'), 'multipart/form-data; boundary=zzz'),
    /boundary not found/,
  );
});

test('handles an empty payload between boundaries', () => {
  const body = buildBody([{ name: 'files', filename: 'a/empty.txt', body: '' }]);
  const parts = parseMultipart(body, `multipart/form-data; boundary=${BOUNDARY}`);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].data.length, 0);
});
