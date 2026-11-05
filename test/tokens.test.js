import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateCatalogTokens, estimateTokens, formatTokens } from '../src/core/tokens.js';

test('empty input costs nothing', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
});

test('latin text lands near one token per four characters', () => {
  const text = 'a'.repeat(400);
  const tokens = estimateTokens(text);
  assert.ok(tokens >= 100 && tokens <= 120, `expected ~111, got ${tokens}`);
});

test('CJK text costs about one token per character', () => {
  const text = '技能中心'.repeat(25); // 100 chars
  const tokens = estimateTokens(text);
  assert.ok(tokens >= 85 && tokens <= 100, `expected ~90, got ${tokens}`);
});

test('mixed text is additive', () => {
  const latin = estimateTokens('hello world');
  const cjk = estimateTokens('你好世界');
  const mixed = estimateTokens('hello world 你好世界');
  assert.ok(mixed >= latin + cjk - 2 && mixed <= latin + cjk + 2);
});

test('is monotonic in length', () => {
  let previous = 0;
  for (let i = 1; i <= 40; i += 1) {
    const tokens = estimateTokens('x'.repeat(i * 10));
    assert.ok(tokens >= previous);
    previous = tokens;
  }
});

test('catalog cost includes the name', () => {
  const withoutName = estimateTokens('short description');
  const withName = estimateCatalogTokens({ name: 'a-very-long-skill-name', description: 'short description' });
  assert.ok(withName > withoutName);
});

test('formats thousands compactly', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(940), '940');
  assert.equal(formatTokens(1234), '1.2k');
  assert.equal(formatTokens(18_400), '18k');
});
