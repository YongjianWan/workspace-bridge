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
  assert(typeof result.schemaVersion === 'string' && result.schemaVersion.length > 0, 'schemaVersion should be present');
  assert(result.scope?.counts?.totalFiles > 1000, `GitNexus should have >1000 files, got ${result.scope?.counts?.totalFiles}`);
  assert.strictEqual(result.summary?.analysisCoverage?.coverageRatio, 1, 'GitNexus should have full AST coverage');
  assert(typeof result.health?.healthScore === 'string', 'healthScore should be a string');
  assert(typeof result.summary?.counts?.deadExports === 'number', 'deadExports count should be a number');
  assert(typeof result.summary?.counts?.unresolved === 'number', 'unresolved count should be a number');
  assert(typeof result.summary?.counts?.cycles === 'number', 'cycles count should be a number');
  assert(Array.isArray(result.deadExports?.deadExports), 'deadExports array should be present');
  assert(Array.isArray(result.unresolved?.unresolved), 'unresolved array should be present');
  assert(Array.isArray(result.cycles?.cycles), 'cycles array should be present');
}

function testAuditFileOnGitNexus() {
  const result = runCli(['audit-file', '--cwd', GITNEXUS_ROOT, '--file', 'gitnexus/scripts/build.js', '--json', '--quiet'], {
    timeout: TIMEOUTS.TEST_RUNNER_MS,
  });
  assert.strictEqual(result.ok, true, 'audit-file should succeed on GitNexus');
  assert(result.file, 'audit-file should return file path');
  assert(Number.isFinite(result.impact?.impactCount), 'impactCount should be a valid number');
}

function testDeadExportsOnGitNexus() {
  const result = runCli(['dead-exports', '--cwd', GITNEXUS_ROOT, '--json', '--quiet'], {
    timeout: TIMEOUTS.TEST_RUNNER_MS,
  });
  assert.strictEqual(result.ok, true, 'dead-exports should succeed on GitNexus');
  assert(Number.isFinite(result.deadExportsCount), 'deadExportsCount should be a valid number');
  assert(Array.isArray(result.deadExports), 'deadExports array should be present');
  // Each entry should have expected shape
  if (result.deadExports.length > 0) {
    const first = result.deadExports[0];
    assert(typeof first.file === 'string', 'dead export entry should have file path');
    assert(Array.isArray(first.exports), 'dead export entry should have exports array');
  }
}

function main() {
  testAuditSummaryOnGitNexus();
  testAuditFileOnGitNexus();
  testDeadExportsOnGitNexus();
  console.log('e2e-gitnexus-test.js: all passed');
}

main();
