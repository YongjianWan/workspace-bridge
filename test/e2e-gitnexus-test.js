#!/usr/bin/env node
/**
 * E2E smoke test on reference/GitNexus — a real third-party project (1329 files).
 * Verifies workspace-bridge produces valid output on non-trivial repositories.
 */
const assert = require('assert');
const path = require('path');
const { TIMEOUTS } = require('../src/config/constants');
const { runCli } = require('./test-helpers');

const GITNEXUS_ROOT = path.join(__dirname, '..', 'reference', 'GitNexus');

function testAuditSummaryOnGitNexus() {
  const result = runCli(['audit-summary', '--cwd', GITNEXUS_ROOT, '--json', '--quiet'], {
    timeout: TIMEOUTS.TEST_RUNNER_MS,
  });
  assert.strictEqual(result.ok, true, 'audit-summary should succeed on GitNexus');
  assert.strictEqual(typeof result.schemaVersion, 'string', 'schemaVersion should be a string');
  assert.ok(result.schemaVersion.length > 0, 'schemaVersion should not be empty');
  assert.ok(result.scope?.counts?.totalFiles > 1000, `GitNexus should have >1000 files, got ${result.scope?.counts?.totalFiles}`);
  assert.strictEqual(result.summary?.analysisCoverage?.coverageRatio, 1, 'GitNexus should have full AST coverage');
  assert.strictEqual(typeof result.health?.healthScore, 'string', 'healthScore should be a string');
  
  assert(Array.isArray(result.deadExports?.deadExports), 'deadExports array should be present');
  assert(Array.isArray(result.unresolved?.unresolved), 'unresolved array should be present');
  assert(Array.isArray(result.cycles?.cycles), 'cycles array should be present');

  // High-signal cross-field consistency assertions
  assert.strictEqual(result.summary?.counts?.deadExports, result.deadExports.deadExports.length, 'deadExports count should match deadExports array length');
  assert.strictEqual(result.summary?.counts?.unresolved, result.unresolved.unresolved.length, 'unresolved count should match unresolved array length');
  assert.strictEqual(result.summary?.counts?.cycles, result.cycles.cycles.length, 'cycles count should match cycles array length');
}

function main() {
  testAuditSummaryOnGitNexus();
  console.log('e2e-gitnexus-test.js: all passed');
}

main();
