import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_TARGET, planShelf } from '../src/core/optimize.js';

function skill(name, catalogTokens) {
  return { name, catalogTokens };
}

test('a catalog that already fits is left untouched', () => {
  const plan = planShelf([skill('a', 100), skill('b', 200)], { budget: 1000 });

  assert.equal(plan.changed, false);
  assert.deepEqual(plan.drop, []);
  assert.equal(plan.after, plan.before);
  assert.equal(plan.saved, 0);
  assert.deepEqual(plan.keep, ['a', 'b']);
});

test('over budget drops the most expensive skill first', () => {
  const plan = planShelf([skill('cheap', 10), skill('pricey', 500), skill('mid', 100)], { budget: 200 });

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.drop, ['pricey']);
  assert.equal(plan.after, 110);
  assert.equal(plan.saved, 500);
  assert.equal(plan.remaining, 2);
});

test('dropping stops as soon as the budget is met', () => {
  const plan = planShelf([skill('a', 300), skill('b', 300), skill('c', 300)], { budget: 350 });

  assert.deepEqual(plan.drop, ['a', 'b']);
  assert.ok(plan.after <= plan.budget);
  assert.deepEqual(plan.keep, ['c']);
});

test('only skills on the shelf are candidates', () => {
  const plan = planShelf([skill('on', 100), skill('off', 900)], { shelf: ['on'], budget: 50 });

  assert.equal(plan.count, 1);
  assert.equal(plan.before, 100);
  assert.deepEqual(plan.drop, ['on']);
});

test('slash-only skills are never dropped to save tokens', () => {
  const plan = planShelf([skill('slash', 0), skill('heavy', 500)], { budget: 100 });

  assert.deepEqual(plan.drop, ['heavy']);
  assert.deepEqual(plan.keep, ['slash']);
});

test('equal cost is broken by name so the plan is reproducible', () => {
  const first = planShelf([skill('b', 100), skill('a', 100)], { budget: 100 });
  const second = planShelf([skill('a', 100), skill('b', 100)], { budget: 100 });

  assert.deepEqual(first.drop, second.drop);
  assert.deepEqual(first.drop, ['a']);
});

test('an unusable budget falls back to the default', () => {
  const plan = planShelf([skill('a', 100)], { budget: 0 });
  assert.equal(plan.budget, DEFAULT_TARGET);

  const negative = planShelf([skill('a', 100)], { budget: -5 });
  assert.equal(negative.budget, DEFAULT_TARGET);
});

test('an empty hub produces an empty plan', () => {
  const plan = planShelf([], { budget: 100 });

  assert.equal(plan.changed, false);
  assert.equal(plan.count, 0);
  assert.equal(plan.total, 0);
});
