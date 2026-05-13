#!/usr/bin/env node

const assert = require('assert');
const { formatHuman } = require('../src/cli/formatters/human-formatters');
const { buildRepoSummary } = require('../src/cli/formatters/repo-summary');

// ---------------------------------------------------------------------------
// formatHuman
// ---------------------------------------------------------------------------

function testFormatHumanError() {
  assert.strictEqual(formatHuman('any', { ok: false, error: 'boom' }), 'Error: boom');
  assert.strictEqual(formatHuman('any', { ok: false }), 'Error: Command failed');
  assert.strictEqual(formatHuman('any', null), 'Error: Command failed');
}

function testFormatHumanAuditSummary() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    scope: { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } },
    summary: { severity: 'medium', honesty: {} },
    health: { healthScore: '4/5' },
    deadExports: { deadExportsCount: 2 },
    unresolved: { unresolvedCount: 1 },
    cycles: { cyclesCount: 0 },
  };
  const out = formatHuman('audit-summary', result);
  assert(out.includes('workspaceRoot: /project'));
  assert(out.includes('totalFiles: 10 (parseable source only; excludes assets/build artifacts/excluded dirs)'));
  assert(out.includes('mainlineFiles: 6'));
  assert(out.includes('nonMainlineFiles: 4'));
  assert(out.includes('deadExportsCount: 2'));
}

function testFormatHumanAuditSummaryWithDisclaimer() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    scope: { counts: { totalFiles: 1, mainlineFiles: 1, nonMainlineFiles: 0 } },
    summary: { severity: 'low', honesty: { disclaimer: 'All clear.' } },
    health: { healthScore: '5/5' },
    deadExports: { deadExportsCount: 0 },
    unresolved: { unresolvedCount: 0 },
    cycles: { cyclesCount: 0 },
  };
  const out = formatHuman('audit-summary', result);
  assert(out.includes('note: All clear.'));
}

function testFormatHumanAuditOverview() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    summary: { severity: 'low' },
    skeleton: { totalFiles: 20, mainlineFiles: 15 },
    aggregates: { hotspotsByRisk: { high: 1, medium: 2 }, stabilityCounts: { fragile: 0 } },
    orphans: { counts: { total: 0 } },
    languageSupport: { javascript: { level: 'ast', confidence: 'high' } },
  };
  const out = formatHuman('audit-overview', result);
  assert(out.includes('totalFiles: 20 (parseable source only; excludes assets/build artifacts/excluded dirs)'));
  assert(out.includes('javascript(ast/high)'));
}

function testFormatHumanHealth() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    healthScore: '5/5',
    packageManager: 'npm',
    checks: { ci: { found: true }, testConfig: { found: true, frameworks: ['jest'] } },
  };
  const out = formatHuman('health', result);
  assert(out.includes('healthScore: 5/5'));
  assert(out.includes('tests: jest'));
}

function testFormatHumanAuditFile() {
  const result = {
    ok: true,
    file: 'src/foo.js',
    resolvedPath: '/project/src/foo.js',
    summary: { severity: 'medium' },
    impact: { impactCount: 3 },
    affectedTests: { affectedTestsCount: 1 },
  };
  const out = formatHuman('audit-file', result);
  assert(out.includes('file: src/foo.js'));
  assert(out.includes('impactCount: 3'));
}

function testFormatHumanDeadExports() {
  const result = {
    ok: true,
    deadExportsCount: 2,
    possibleFalsePositives: { disclaimer: 'Likely false positives.' },
    deadExports: [
      { file: 'a.js', exports: ['x', 'y'] },
    ],
  };
  const out = formatHuman('dead-exports', result);
  assert(out.includes('deadExportsCount: 2'));
  assert(out.includes('note: Likely false positives.'));
  assert(out.includes('a.js: x, y'));
}

function testFormatHumanUnresolved() {
  const result = {
    ok: true,
    unresolvedCount: 1,
    possibleFalsePositives: { disclaimer: 'May be alias.' },
    unresolved: [{ file: 'a.js', import: './missing' }],
  };
  const out = formatHuman('unresolved', result);
  assert(out.includes('unresolvedCount: 1'));
  assert(out.includes('a.js: ./missing'));
}

function testFormatHumanCycles() {
  const result = {
    ok: true,
    cyclesCount: 1,
    cycles: [['a.js', 'b.js', 'a.js']],
  };
  const out = formatHuman('cycles', result);
  assert(out.includes('cyclesCount: 1'));
  assert(out.includes('a.js -> b.js -> a.js'));
}

function testFormatHumanImpact() {
  const result = {
    ok: true,
    impactCount: 2,
    impact: [
      { level: 1, file: 'b.js', via: ['a.js', 'b.js'] },
      { level: 2, file: 'c.js' },
    ],
  };
  const out = formatHuman('impact', result);
  assert(out.includes('impactCount: 2'));
  assert(out.includes('1: b.js via b.js'));
  assert(out.includes('2: c.js'));
}

function testFormatHumanAffectedTests() {
  const result = {
    ok: true,
    affectedTestsCount: 1,
    affectedTests: [{ distance: 1, file: 'test/a.test.js', via: ['src/a.js'] }],
  };
  const out = formatHuman('affected-tests', result);
  assert(out.includes('affectedTestsCount: 1'));
  assert(out.includes('1: test/a.test.js via src/a.js'));
}

function testFormatHumanDependencies() {
  const result = {
    ok: true,
    file: 'src/a.js',
    dependenciesCount: 2,
    dependencies: ['src/b.js', 'src/c.js'],
  };
  const out = formatHuman('dependencies', result);
  assert(out.includes('dependenciesCount: 2'));
  assert(out.includes('  → src/b.js'));
}

function testFormatHumanDependents() {
  const result = {
    ok: true,
    file: 'src/a.js',
    dependentsCount: 1,
    dependents: ['src/b.js'],
  };
  const out = formatHuman('dependents', result);
  assert(out.includes('dependentsCount: 1'));
  assert(out.includes('  ← src/b.js'));
}

function testFormatHumanStats() {
  const result = { ok: true, stats: { files: 10, imports: 20 } };
  const out = formatHuman('stats', result);
  assert(out.includes('files: 10'));
  assert(out.includes('imports: 20'));
}

function testFormatHumanAuditDiff() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    summary: {
      severity: 'medium',
      counts: { changedFiles: 2, mainlineChangedFiles: 1, affectedTests: 3, maxImpact: 2, highHistoryRiskFiles: 0, highCompositeRiskFiles: 0 },
      fileTypeBreakdown: { js: 2 },
      changeMetrics: { totalAdditions: 10, totalDeletions: 5 },
    },
    changedFiles: [],
    validationAdvice: { phases: [], topRiskActions: [] },
  };
  const out = formatHuman('audit-diff', result);
  assert(out.includes('severity: medium'));
  assert(out.includes('changedFiles: 2'));
  assert(out.includes('validationPhases: 0'));
}

function testFormatHumanAuditMapWithSummary() {
  const result = {
    ok: true,
    summary: { severity: 'low', nextSteps: ['Check imports.'] },
    tree: [{ type: 'file', name: 'a.js', path: 'a.js' }],
    edges: [],
    issueOverlay: { unresolved: [], cycles: [], deadExports: [], orphans: [], hotspots: [] },
  };
  const out = formatHuman('audit-map', result);
  assert(out.includes('severity: low'));
  assert(out.includes('next: Check imports.'));
}

function testFormatHumanAuditMapWithoutSummary() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    tree: [{ type: 'file', name: 'a.js', path: 'a.js' }],
    edges: [],
    issueOverlay: { unresolved: [], cycles: [], deadExports: [], orphans: [], hotspots: [] },
  };
  const out = formatHuman('audit-map', result);
  assert(out.includes('workspaceRoot: /project'));
}

function testFormatHumanDiagnostics() {
  const result = {
    ok: true,
    checksRun: 5,
    failedChecks: ['lint'],
    diagnosticsSummary: { total: 3 },
  };
  const out = formatHuman('diagnostics', result);
  assert(out.includes('checksRun: 5'));
  assert(out.includes('failedChecks: lint'));
  assert(out.includes('diagnostics: 3'));
}

function testFormatHumanDiagnosticsNoLinters() {
  const result = {
    ok: true,
    checksRun: 2,
    failedChecks: [],
    diagnosticsSummary: { noLintersDetected: true },
  };
  const out = formatHuman('diagnostics', result);
  assert(out.includes('diagnostics: no linters detected'));
}

function testFormatHumanWorkspaceInfo() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    detected: { node: true, python: false },
  };
  const out = formatHuman('workspace-info', result);
  assert(out.includes('detected: node'));
}

function testFormatHumanAuditSecurity() {
  const result = {
    ok: true,
    adapters: ['semgrep'],
    summary: { total: 1, bySeverity: { high: 1, medium: 0, low: 0 } },
    findings: [{ severity: 'high', ruleId: 'xss', file: 'a.js', lineStart: 10, message: 'bad' }],
  };
  const out = formatHuman('audit-security', result);
  assert(out.includes('findings: 1'));
  assert(out.includes('[HIGH] xss — a.js:10'));
  assert(out.includes('  bad'));
}

function testFormatHumanDefaultFallback() {
  const result = { ok: true, foo: 'bar' };
  const out = formatHuman('unknown-cmd', result);
  assert(out.includes('"foo": "bar"'));
}

// ---------------------------------------------------------------------------
// buildRepoSummary
// ---------------------------------------------------------------------------

function testBuildRepoSummaryBasic() {
  const health = { healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, checks: {} };
  const deadExports = { deadExportsCount: 0, possibleFalsePositives: {} };
  const unresolved = { unresolvedCount: 0, possibleFalsePositives: {} };
  const cycles = { cyclesCount: 0 };
  const scope = { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } };

  const summary = buildRepoSummary(health, deadExports, unresolved, cycles, scope);
  assert.strictEqual(summary.severity, 'low');
  assert.strictEqual(summary.counts.deadExports, 0);
  assert.strictEqual(summary.counts.unresolved, 0);
  assert.strictEqual(summary.counts.cycles, 0);
  assert.strictEqual(summary.honesty.deadExports.total, 0);
  assert(summary.nextSteps.length > 0);
  assert(summary.nextSteps.some((s) => s.includes('totalFiles counts only parseable source files')));
}

function testBuildRepoSummaryCoverageWarning() {
  const health = { healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, checks: {} };
  const deadExports = { deadExportsCount: 0, possibleFalsePositives: {} };
  const unresolved = { unresolvedCount: 0, possibleFalsePositives: {} };
  const cycles = { cyclesCount: 0 };
  const scope = { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 0 } };
  const analysisCoverage = { totalFiles: 10, parsedFiles: 2, fallbackFiles: 0, coverageRatio: 0.2 };

  const summary = buildRepoSummary(health, deadExports, unresolved, cycles, scope, 'unknown', analysisCoverage);
  assert.strictEqual(summary.severity, 'high');
  assert.strictEqual(summary.coverageWarning, 'Analysis coverage is low (20%); findings may be incomplete');
}

function testBuildRepoSummaryNodeStack() {
  const health = { healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, checks: {} };
  const deadExports = { deadExportsCount: 1, possibleFalsePositives: {} };
  const unresolved = { unresolvedCount: 1, possibleFalsePositives: {} };
  const cycles = { cyclesCount: 1 };
  const scope = { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } };

  const summary = buildRepoSummary(health, deadExports, unresolved, cycles, scope, 'node-first');
  // Node stack: unresolved -> cycle -> dead-exports
  assert(summary.nextSteps[0].includes('unresolved') || summary.nextSteps[0].includes('Inspect'), `Expected unresolved first for node, got: ${summary.nextSteps[0]}`);
}

function testBuildRepoSummaryJavaStack() {
  const health = { healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, checks: {} };
  const deadExports = { deadExportsCount: 1, possibleFalsePositives: {} };
  const unresolved = { unresolvedCount: 1, possibleFalsePositives: {} };
  const cycles = { cyclesCount: 1 };
  const scope = { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } };

  const summary = buildRepoSummary(health, deadExports, unresolved, cycles, scope, 'java-first');
  // Java stack: cycle -> dead-exports -> unresolved
  assert(summary.nextSteps[0].includes('cycle'), `Expected cycle first for java, got: ${summary.nextSteps[0]}`);
  assert(summary.nextSteps[1].includes('dead export') || summary.nextSteps[1].includes('dead-export'), `Expected dead-exports second for java, got: ${summary.nextSteps[1]}`);
}

function testBuildRepoSummaryNoNonMainline() {
  const health = { healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, checks: {} };
  const deadExports = { deadExportsCount: 0, possibleFalsePositives: {} };
  const unresolved = { unresolvedCount: 0, possibleFalsePositives: {} };
  const cycles = { cyclesCount: 0 };
  const scope = { counts: { totalFiles: 10, mainlineFiles: 10, nonMainlineFiles: 0 } };

  const summary = buildRepoSummary(health, deadExports, unresolved, cycles, scope);
  assert(summary.nextSteps.some((s) => s.includes('totalFiles counts only parseable source files')));
  assert(!summary.nextSteps.some((s) => s.includes('mixed repositories')));
}

function main() {
  testFormatHumanError();
  testFormatHumanAuditSummary();
  testFormatHumanAuditSummaryWithDisclaimer();
  testFormatHumanAuditOverview();
  testFormatHumanHealth();
  testFormatHumanAuditFile();
  testFormatHumanDeadExports();
  testFormatHumanUnresolved();
  testFormatHumanCycles();
  testFormatHumanImpact();
  testFormatHumanAffectedTests();
  testFormatHumanDependencies();
  testFormatHumanDependents();
  testFormatHumanStats();
  testFormatHumanAuditDiff();
  testFormatHumanAuditMapWithSummary();
  testFormatHumanAuditMapWithoutSummary();
  testFormatHumanDiagnostics();
  testFormatHumanDiagnosticsNoLinters();
  testFormatHumanWorkspaceInfo();
  testFormatHumanAuditSecurity();
  testFormatHumanDefaultFallback();

  testBuildRepoSummaryBasic();
  testBuildRepoSummaryCoverageWarning();
  testBuildRepoSummaryNodeStack();
  testBuildRepoSummaryJavaStack();
  testBuildRepoSummaryNoNonMainline();

  console.log('formatter-direct-test: all passed');
}

main();
