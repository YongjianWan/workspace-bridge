#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliInProcessRaw } = require('./test-helpers');

async function testMaxDepthBounds() {
  const result = await runCliInProcessRaw(['audit-summary', '--max-depth', '0']);
  assert.strictEqual(result.status, 1, 'zero max depth should fail with exit code 1 (VALIDATION_ERROR)');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --max-depth value'), 'should specify max depth invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

async function testTokenBudgetBounds() {
  const result = await runCliInProcessRaw(['audit-summary', '--token-budget', '-5']);
  assert.strictEqual(result.status, 1, 'negative token budget should fail with exit code 1 (VALIDATION_ERROR)');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --token-budget value'), 'should specify token budget invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

async function testLimitBounds() {
  const result = await runCliInProcessRaw(['query-hotspots', '--limit', '0']);
  assert.strictEqual(result.status, 1, 'zero limit should fail with exit code 1 (VALIDATION_ERROR)');
  const out = result.stderr || result.stdout || '';
  assert(out.toLowerCase().includes('invalid --limit value'), 'should specify limit invalidation');
  assert(!out.includes('Usage:'), 'should not pollute stderr with help instructions');
}

async function main() {
  await testMaxDepthBounds();
  await testTokenBudgetBounds();
  await testLimitBounds();
  console.log('bug-15-cli-bounds-validation-test.js: all passed');
}

main();
