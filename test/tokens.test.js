import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateCatalogTokens, estimateTokens, formatTokens, budgetState, projectUsage, tierOf } from '../src/core/tokens.js';

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

test('tiers bucket skills by catalog cost', () => {
  assert.equal(tierOf(0).id, 'light');
  assert.equal(tierOf(25).id, 'light');
  assert.equal(tierOf(26).id, 'normal');
  assert.equal(tierOf(60).id, 'normal');
  assert.equal(tierOf(61).id, 'heavy');
  assert.equal(tierOf(120).id, 'heavy');
  assert.equal(tierOf(121).id, 'extreme');
  assert.ok(tierOf(500).hint.length > 0);
});

test('projects the cost over a day and a month', () => {
  const projection = projectUsage({ visibleTokens: 1200, dailyRequests: 50 });
  assert.equal(projection.perRequest, 1200);
  assert.equal(projection.perDay, 60_000);
  assert.equal(projection.perMonth, 1_800_000);
});

test('projection falls back to a sane request volume', () => {
  const projection = projectUsage({ visibleTokens: 100, dailyRequests: 0 });
  assert.equal(projection.perDay, 10_000); // default 100 requests/day
});

test('budget state flips at 80% and 100%', () => {
  assert.equal(budgetState(500, 2000).state, 'ok');
  assert.equal(budgetState(1600, 2000).state, 'warn');
  assert.equal(budgetState(2000, 2000).state, 'over');
  assert.equal(budgetState(2600, 2000).state, 'over');
  assert.equal(budgetState(10, 0).state, 'ok'); // no budget configured
  assert.equal(budgetState(500, 2000).ratio, 0.25);
});
