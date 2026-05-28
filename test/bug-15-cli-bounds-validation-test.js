#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function testMaxDepthBounds() {
  const result = runCliRaw(['audit-summary', '--max-depth', '0']);
  assert.strictEqual(result.status, 2, 'zero max depth should fail with exit code 2');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --max-depth value'), 'should specify max depth invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

function testTokenBudgetBounds() {
  const result = runCliRaw(['audit-summary', '--token-budget', '-5']);
  assert.strictEqual(result.status, 2, 'negative token budget should fail with exit code 2');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --token-budget value'), 'should specify token budget invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

function testLimitBounds() {
  const result = runCliRaw(['query-hotspots', '--limit', '0']);
  assert.strictEqual(result.status, 2, 'zero limit should fail with exit code 2');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --limit value'), 'should specify limit invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

function main() {
  testMaxDepthBounds();
  testTokenBudgetBounds();
  testLimitBounds();
  console.log('bug-15-cli-bounds-validation-test.js: all passed');
}

main();
