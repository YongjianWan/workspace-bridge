#!/usr/bin/env node
// @semantic
/**
 * E2E smoke test on reference/GitNexus — a real third-party project (1329 files).
 * Verifies workspace-bridge produces valid output on non-trivial repositories.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TIMEOUTS } = require('../src/config/constants');
const { DEFAULTS } = require('../src/config/defaults');
const { runCliInProcess } = require('./test-helpers');

const GITNEXUS_ROOT = path.join(__dirname, '..', 'reference', 'GitNexus');
const SHARED_CACHE_DIR = path.join(os.tmpdir(), 'wb-gitnexus-shared-cache');

async function testAuditSummaryOnGitNexus() {
  const result = await runCliInProcess(
    ['audit-summary', '--cwd', GITNEXUS_ROOT, '--json', '--quiet', '--cache-dir', SHARED_CACHE_DIR],
    {
      timeout: TIMEOUTS.TEST_RUNNER_MS,
    }
  );
  assert.strictEqual(result.ok, true, 'audit-summary should succeed on GitNexus');
  assert.strictEqual(typeof result.schemaVersion, 'string', 'schemaVersion should be a string');
  assert.ok(result.schemaVersion.length > 0, 'schemaVersion should not be empty');
  assert.ok(result.scope?.counts?.totalFiles > 1000, `GitNexus should have >1000 files, got ${result.scope?.counts?.totalFiles}`);
  assert.strictEqual(result.summary?.analysisCoverage?.coverageRatio, 1, 'GitNexus should have full AST coverage');
  assert.strictEqual(typeof result.health?.healthScore, 'string', 'healthScore should be a string');
  
  assert(Array.isArray(result.deadExports?.deadExports), 'deadExports array should be present');
  assert(Array.isArray(result.unresolved?.unresolved), 'unresolved array should be present');
  assert(Array.isArray(result.cycles?.cycles), 'cycles array should be present');

  // High-signal cross-field consistency assertions.
  // JSON output elides arrays at JSON_OUTPUT_MAX_ARRAY_ITEMS (elideDeep) while
  // summary.counts carries true totals: below the cap they must be equal,
  // above it the array must sit exactly at the cap.
  const cap = DEFAULTS.JSON_OUTPUT_MAX_ARRAY_ITEMS;
  assert.strictEqual(result.deadExports.deadExports.length, Math.min(result.summary?.counts?.deadExports, cap), 'deadExports array length should match counts (elided at cap)');
  assert.strictEqual(result.unresolved.unresolved.length, Math.min(result.summary?.counts?.unresolved, cap), 'unresolved array length should match counts (elided at cap)');
  assert.strictEqual(result.cycles.cycles.length, Math.min(result.summary?.counts?.cycles, cap), 'cycles array length should match counts (elided at cap)');
}

async function main() {
  // reference/GitNexus is a local, gitignored fixture. Without this guard the
  // full runner hard-FAILs on any clean clone (and in any git worktree) with a
  // "Directory not found" that looks like a real regression.
  if (!fs.existsSync(GITNEXUS_ROOT)) {
    console.log(`e2e-gitnexus-test.js: SKIP (fixture not present at ${GITNEXUS_ROOT})`);
    return;
  }
  await testAuditSummaryOnGitNexus();
  console.log('e2e-gitnexus-test.js: all passed');
}

main();
