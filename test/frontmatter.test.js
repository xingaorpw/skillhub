import assert from 'node:assert/strict';
import test from 'node:test';

import { parse, setDescription } from '../src/core/frontmatter.js';

const SIMPLE = `---
name: tdd
description: Test-driven development.
---

# TDD

Body text.
`;

test('parses flat frontmatter and keeps the body intact', () => {
  const { data, body, hasFrontmatter } = parse(SIMPLE);
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'tdd');
  assert.equal(data.description, 'Test-driven development.');
  assert.match(body, /# TDD/);
  assert.match(body, /Body text\./);
});

test('returns the input untouched when there is no frontmatter', () => {
  const text = '# Just a document\n\nNo fences here.';
  const parsed = parse(text);
  assert.equal(parsed.hasFrontmatter, false);
  assert.equal(parsed.body, text);
  assert.deepEqual(parsed.data, {});
});

test('unquotes single and double quoted values', () => {
  const { data } = parse(`---
name: "quoted"
description: 'single quoted'
---\n`);
  assert.equal(data.name, 'quoted');
  assert.equal(data.description, 'single quoted');
});

test('folds block scalars and keeps literal newlines for |', () => {
  const folded = parse(`---
description: >
  first line
  second line
---\n`);
  assert.equal(folded.data.description, 'first line second line');

  const literal = parse(`---
description: |
  first line
  second line
---\n`);
  assert.equal(literal.data.description, 'first line\nsecond line');
});

test('handles CRLF line endings', () => {
  const { data, body } = parse('---\r\nname: crlf\r\n---\r\n\r\nbody\r\n');
  assert.equal(data.name, 'crlf');
  assert.match(body, /body/);
});

test('setDescription replaces one line and preserves everything else', () => {
  const next = setDescription(SIMPLE, '短描述');
  assert.match(next, /^---\nname: tdd\ndescription: 短描述\n---\n/);
  assert.match(next, /# TDD\n\nBody text\.\n$/);
  assert.equal(parse(next).data.name, 'tdd');
});

test('setDescription drops a folded continuation block', () => {
  const text = `---
name: x
description: >
  long folded
  description here
other: keep
---\n\nbody\n`;
  const next = setDescription(text, 'short');
  assert.equal(parse(next).data.description, 'short');
  assert.equal(parse(next).data.other, 'keep');
  assert.match(next, /body/);
});

test('setDescription is a no-op without frontmatter', () => {
  assert.equal(setDescription('# hi', 'x'), '# hi');
});
