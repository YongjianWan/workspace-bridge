#!/usr/bin/env node
/**
 * Formatter end-to-end tests — summary / overview formatters.
 * Uses in-process runner (shared ServiceContainer) for speed.
 */
const assert = require('assert');
const { runCliInProcessText, shutdownSharedContainer } = require('./test-helpers');

async function testAuditSummaryHuman() {
  const out = await runCliInProcessText(['audit-summary', '--cwd', '.', '--quiet', '--format', 'human']);
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

async function testAuditSummaryJson() {
  const out = await runCliInProcessText(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  const result = JSON.parse(out);
  assert(result.scope.counts.totalFiles >= 1, 'should have totalFiles');
  assert(result.scope.counts.mainlineFiles >= 0, 'should have mainlineFiles');
  assert(Array.isArray(result.summary.nextSteps), 'should have nextSteps array');
  assert(
    result.summary.nextSteps.some((s) => s.includes('totalFiles counts only parseable source files')),
    'nextSteps should include totalFiles explanation'
  );
}

async function testAuditOverviewHuman() {
  const out = await runCliInProcessText(['audit-overview', '--cwd', '.', '--quiet', '--format', 'human']);
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

async function testAuditOverviewJson() {
  const out = await runCliInProcessText(['audit-overview', '--cwd', '.', '--json', '--quiet']);
  const result = JSON.parse(out);
  assert(result.skeleton.totalFiles >= 1, 'should have skeleton.totalFiles');
  assert(result.skeleton.mainlineFiles >= 0, 'should have skeleton.mainlineFiles');
  assert(Array.isArray(result.hotspots), 'should have hotspots array');
}

async function main() {
  try {
    await testAuditSummaryHuman();
    await testAuditSummaryJson();
    await testAuditOverviewHuman();
    await testAuditOverviewJson();
    console.log('formatter-e2e-summary-test.js: all passed');
  } finally {
    shutdownSharedContainer();
  }
}

main();
