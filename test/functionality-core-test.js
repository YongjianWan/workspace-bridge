#!/usr/bin/env node
// @semantic
/**
 * CLI 核心功能可用性测试
 * Runs on the workspace-bridge repo itself for commands that need a real project.
 * audit-diff is executed in an isolated temp repo to avoid polluting the worktree.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCliInProcess, runCliInProcessText, runInDir, REPO_ROOT, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const workspaceInfo = await runCliInProcess(['workspace-info', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(workspaceInfo.workspaceRoot, REPO_ROOT);

  const health = await runCliInProcess(['health', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(health.ok, true);
  assert(typeof health.healthScore === 'string' && health.healthScore.includes('/'), 'health should return meaningful healthScore');
  assert(health.checks?.readme?.found === true, 'health checks should include readme');

  const summary = await runCliInProcess(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  assert(summary.scope.counts.totalFiles >= 1);

  const fileAudit = await runCliInProcess(['audit-file', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
  assert(fileAudit.impact.impactCount >= 0);

  // audit-diff runs in an isolated temp repo so it does not interfere with concurrent tests.
  const diffDir = makeTempDir('wb-diff-core-');
  fs.writeFileSync(path.join(diffDir, 'package.json'), JSON.stringify({ name: 'diff-test', version: '1.0.0' }));
  fs.writeFileSync(path.join(diffDir, 'a.js'), 'console.log(1);\n');
  runInDir('git', ['init'], diffDir);
  runInDir('git', ['config', 'user.email', 'test@example.com'], diffDir);
  runInDir('git', ['config', 'user.name', 'Test User'], diffDir);
  runInDir('git', ['add', '.'], diffDir);
  runInDir('git', ['commit', '-m', 'init'], diffDir);
  fs.writeFileSync(path.join(diffDir, 'a.js'), 'console.log(2);\n');

  const diffAudit = await runCliInProcess(['audit-diff', '--cwd', diffDir, '--json', '--quiet']);
  assert(diffAudit.summary.counts.changedFiles >= 0, 'audit-diff should work on clean worktree');
  assert(diffAudit.validationAdvice.stack.profile);
  assert(Array.isArray(diffAudit.validationAdvice.topRiskActions));
  assert(diffAudit.summary.counts.highCompositeRiskFiles >= 0, 'highCompositeRiskFiles should be non-negative');
  assert(diffAudit.summary.counts.maxCompositeRiskScore >= 0, 'maxCompositeRiskScore should be non-negative');

  const diffHuman = await runCliInProcessText(['audit-diff', '--cwd', diffDir, '--quiet', '--format', 'human']);
  assert(diffHuman.includes('topCompositeRisk:'), 'audit-diff human output should include topCompositeRisk');
  assert(diffHuman.includes('topRiskAction:'), 'audit-diff human output should include topRiskAction');
  assert(diffHuman.includes('topRiskCommand:'), 'audit-diff human output should include topRiskCommand');
  cleanupTempDir(diffDir);

    const overviewDataDir = makeTempDir('wb-overview-cli-');
    const overviewDataFile = path.join(overviewDataDir, 'hotspots.json');
    const trendDataFile = path.join(overviewDataDir, 'stability-trend.json');
    const dashboardFile = path.join(overviewDataDir, 'overview.html');
    const overview = await runCliInProcess([
      'audit-overview',
      '--cwd', '.',
      '--hotspot-data', overviewDataFile,
      '--stability-trend-data', trendDataFile,
      '--overview-dashboard', dashboardFile,
      '--trend-granularity', 'week',
      '--json',
      '--quiet',
    ]);
    assert.strictEqual(overview.ok, true);
    assert(overview.skeleton.totalFiles >= 1);
    assert(overview.aggregates, 'overview aggregates should exist');
    assert(overview.architectureAdvice, 'overview architectureAdvice should exist');
    assert(Array.isArray(overview.architectureAdvice.cycleRefactorSuggestions), 'overview cycle suggestions should exist');
    assert(Array.isArray(overview.architectureAdvice.couplingSplitSuggestions), 'overview coupling suggestions should exist');
    assert.strictEqual(overview.options?.hotspotData?.enabled, true);
    assert.strictEqual(overview.options?.stabilityTrendData?.enabled, true);
    assert.strictEqual(overview.options?.stabilityTrendData?.granularity, 'week');
    assert.strictEqual(overview.options?.overviewDashboard?.enabled, true);
    assert.strictEqual(overview.hotspotDataFile, overviewDataFile);
    assert.strictEqual(overview.stabilityTrendDataFile, trendDataFile);
    assert.strictEqual(overview.overviewDashboardFile, dashboardFile);
    assert(fs.existsSync(overviewDataFile), 'audit-overview should write hotspot data file');
    assert(fs.existsSync(trendDataFile), 'audit-overview should write stability trend data file');
    assert(fs.existsSync(dashboardFile), 'audit-overview should write dashboard html file');
    const overviewData = JSON.parse(fs.readFileSync(overviewDataFile, 'utf8'));
    assert.strictEqual(overviewData.schemaVersion, '1.2.0');
    assert(Array.isArray(overviewData.hotspots));
    const trendData = JSON.parse(fs.readFileSync(trendDataFile, 'utf8'));
    assert.strictEqual(trendData.schemaVersion, '1.2.0');
    assert.strictEqual(trendData.granularity, 'week');
    assert(Array.isArray(trendData.series));
    const dashboardHtml = fs.readFileSync(dashboardFile, 'utf8');
    assert(dashboardHtml.includes('Workspace Overview Dashboard'));
    assert(overview.stabilityTrend?.latest?.stabilityScore >= 0, `stabilityScore should be >= 0, got ${overview.stabilityTrend?.latest?.stabilityScore}`);
    assert(overview.stabilityTrend?.latest?.fragileCount >= 0, `fragileCount should be >= 0, got ${overview.stabilityTrend?.latest?.fragileCount}`);
    cleanupTempDir(overviewDataDir);

    const overviewHuman = await runCliInProcessText(['audit-overview', '--cwd', '.', '--quiet', '--format', 'human']);
    assert(overviewHuman.includes('hotspotsHigh:'), 'audit-overview human output should include hotspot aggregates');

    const deadExports = await runCliInProcess(['dead-exports', '--cwd', '.', '--json', '--quiet']);
    assert.strictEqual(deadExports.ok, true);
    assert(Array.isArray(deadExports.deadExports));

    const unresolved = await runCliInProcess(['unresolved', '--cwd', '.', '--json', '--quiet']);
    assert.strictEqual(unresolved.ok, true);
    assert(Array.isArray(unresolved.unresolved));

    const cycles = await runCliInProcess(['cycles', '--cwd', '.', '--json', '--quiet']);
    assert.strictEqual(cycles.ok, true);
    assert(Array.isArray(cycles.cycles));

    const diagnosticsQuick = await runCliInProcess(['diagnostics', '--cwd', '.', '--mode', 'quick', '--json', '--quiet']);
    assert(diagnosticsQuick.ok === true, 'quick diagnostics should succeed');

}

main();
