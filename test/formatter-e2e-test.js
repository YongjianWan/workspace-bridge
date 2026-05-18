#!/usr/bin/env node
/**
 * Formatter end-to-end tests.
 * Runs real CLI commands and asserts on human-readable output structure.
 * Complements formatter-direct-test.js (unit) with a second layer of validation.
 */
const assert = require('assert');
const path = require('path');
const { runCliText, runCliRaw } = require('./test-helpers');

// ---------------------------------------------------------------------------
// audit-summary human output
// ---------------------------------------------------------------------------

function testAuditSummaryHuman() {
  const out = runCliText(['audit-summary', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('workspaceRoot:'), 'should show workspaceRoot');
  assert(out.includes('severity:'), 'should show severity');
  assert(out.includes('healthScore:'), 'should show healthScore');
  assert(
    out.includes('totalFiles:') && out.includes('parseable source only'),
    'should show totalFiles with P83/P88 annotation'
  );
  assert(out.includes('mainlineFiles:'), 'should show mainlineFiles');
  assert(out.includes('nonMainlineFiles:'), 'should show nonMainlineFiles');
  assert(out.includes('deadExportsCount:'), 'should show deadExportsCount');
  assert(out.includes('unresolvedCount:'), 'should show unresolvedCount');
  assert(out.includes('cyclesCount:'), 'should show cyclesCount');
}

function testAuditSummaryJson() {
  const out = runCliText(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  const result = JSON.parse(out);
  assert(result.scope.counts.totalFiles >= 1, 'should have totalFiles');
  assert(result.scope.counts.mainlineFiles >= 0, 'should have mainlineFiles');
  assert(Array.isArray(result.summary.nextSteps), 'should have nextSteps array');
  assert(
    result.summary.nextSteps.some((s) => s.includes('totalFiles counts only parseable source files')),
    'nextSteps should include totalFiles explanation'
  );
}

// ---------------------------------------------------------------------------
// audit-overview human output
// ---------------------------------------------------------------------------

function testAuditOverviewHuman() {
  const out = runCliText(['audit-overview', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('workspaceRoot:'), 'should show workspaceRoot');
  assert(out.includes('severity:'), 'should show severity');
  assert(
    out.includes('totalFiles:') && out.includes('parseable source only'),
    'should show totalFiles with P83/P88 annotation'
  );
  assert(out.includes('mainlineFiles:'), 'should show mainlineFiles');
  assert(out.includes('hotspotsHigh:'), 'should show hotspotsHigh');
  assert(out.includes('hotspotsMedium:'), 'should show hotspotsMedium');
  assert(out.includes('languages:'), 'should show languages');
}

function testAuditOverviewJson() {
  const out = runCliText(['audit-overview', '--cwd', '.', '--json', '--quiet']);
  const result = JSON.parse(out);
  assert(result.skeleton.totalFiles >= 1, 'should have skeleton.totalFiles');
  assert(result.skeleton.mainlineFiles >= 0, 'should have skeleton.mainlineFiles');
  assert(Array.isArray(result.hotspots), 'should have hotspots array');
}

// ---------------------------------------------------------------------------
// audit-file human output
// ---------------------------------------------------------------------------

function testAuditFileHuman() {
  const out = runCliText(['audit-file', '--file', 'cli.js', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('file:'), 'should show file');
  assert(out.includes('severity:'), 'should show severity');
  assert(out.includes('impactCount:'), 'should show impactCount');
  assert(out.includes('affectedTestsCount:'), 'should show affectedTestsCount');
}

// ---------------------------------------------------------------------------
// health human output
// ---------------------------------------------------------------------------

function testHealthHuman() {
  const out = runCliText(['health', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('workspaceRoot:'), 'should show workspaceRoot');
  assert(out.includes('healthScore:'), 'should show healthScore');
  assert(out.includes('packageManager:'), 'should show packageManager');
  assert(out.includes('ci:'), 'should show ci');
  assert(out.includes('tests:'), 'should show tests');
}

// ---------------------------------------------------------------------------
// stats human output
// ---------------------------------------------------------------------------

function testStatsHuman() {
  const out = runCliText(['stats', '--cwd', '.', '--quiet', '--format', 'human']);
  // stats outputs key: value lines
  const lines = out.split('\n').filter(Boolean);
  assert(lines.length >= 1, 'should have at least one stat line');
  assert(lines.every((l) => l.includes(':')), 'every line should be key: value format');
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

function testFormatHumanErrorFallback() {
  const result = runCliRaw(['impact', '--file', 'nonexistent-file.js', '--cwd', '.', '--quiet', '--format', 'human']);
  assert.notStrictEqual(result.status, 0, 'error command should have non-zero exit');
  assert(result.stdout.startsWith('Error:'), 'error output should start with Error:');
}

function main() {
  testAuditSummaryHuman();
  testAuditSummaryJson();
  testAuditOverviewHuman();
  testAuditOverviewJson();
  testAuditFileHuman();
  testHealthHuman();
  testStatsHuman();
  testFormatHumanErrorFallback();
}

main();
