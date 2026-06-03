#!/usr/bin/env node

const assert = require('assert');
const { formatHuman, formatSummary, formatMarkdown, formatJsonl, formatAi } = require('../src/cli/formatters/human-formatters');
const { buildRepoSummary } = require('../src/cli/formatters/repo-summary');
const { buildCompositeRisk } = require('../src/cli/formatters/composite-risk');
const { buildAuditDiffSummary, classifyChangeType } = require('../src/cli/formatters/audit-diff-summary');

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
    deadExports: { deadExportsCount: 2, deadExports: [{ file: 'a.js', exports: ['x'] }] },
    unresolved: { unresolvedCount: 1, unresolved: [{ file: 'b.js', import: 'foo' }] },
    cycles: { cyclesCount: 1, cycles: [['c.js', 'd.js']] },
  };
  const out = formatHuman('audit-overview', result);
  assert(out.includes('totalFiles: 20 (parseable source only; excludes assets/build artifacts/excluded dirs)'));
  assert(out.includes('javascript(ast/high)'));
  assert(out.includes('deadExportsCount: 2'));
  assert(out.includes('unresolvedCount: 1'));
  assert(out.includes('cyclesCount: 1'));
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

function testFormatHumanTree() {
  const result = {
    ok: true,
    file: 'src/a.js',
    tree: {
      file: 'src/a.js',
      imports: [
        { file: 'src/b.js', depth: 1, imports: [{ file: 'src/c.js', depth: 2 }] },
        { file: 'lodash', depth: 1, external: true },
      ],
      dependents: [
        { file: 'src/d.js', depth: 1, dependents: [{ file: 'src/e.js', depth: 2 }] },
      ],
    },
  };
  const out = formatHuman('tree', result);
  assert(out.includes('file: src/a.js'));
  assert(out.includes('→ src/b.js'));
  assert(out.includes('→ src/c.js'));
  assert(out.includes('→ lodash [external]'));
  assert(out.includes('← src/d.js'));
  assert(out.includes('← src/e.js'));
}

// ---------------------------------------------------------------------------
// formatSummary
// ---------------------------------------------------------------------------

function testFormatSummaryAuditSummary() {
  const result = {
    ok: true,
    workspaceRoot: '/project',
    scope: { counts: { totalFiles: 10, mainlineFiles: 6 } },
    summary: { severity: 'medium', nextSteps: ['Step A', 'Step B', 'Step C'], analysisCoverage: { parsedFiles: 10, totalFiles: 10, coverageRatio: 1 } },
    health: { healthScore: '4/5' },
    deadExports: { deadExportsCount: 2 },
    unresolved: { unresolvedCount: 1 },
    cycles: { cyclesCount: 0 },
  };
  const out = formatSummary('audit-summary', result);
  const lines = out.split('\n');
  assert(lines.length <= 10, `Expected <= 10 lines, got ${lines.length}`);
  assert(out.includes('Severity: medium'));
  assert(out.includes('Health: 4/5'));
  assert(out.includes('Files: 10 total, 6 mainline'));
  assert(out.includes('Issues: 2 dead exports, 1 unresolved, 0 cycles'));
  assert(out.includes('Coverage: 10/10 parsed (100%)'));
  assert(out.includes('Next steps:'));
  assert(out.includes('Step A'));
}

function testFormatSummaryAuditSecurity() {
  const result = {
    ok: true,
    adapters: ['builtin'],
    summary: { total: 3, bySeverity: { high: 1, medium: 1, low: 1 } },
    findings: [
      { severity: 'high', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm1' },
      { severity: 'medium', ruleId: 'r2', file: 'b.js', lineStart: 2, message: 'm2' },
      { severity: 'low', ruleId: 'r3', file: 'c.js', lineStart: 3, message: 'm3' },
    ],
  };
  const out = formatSummary('audit-security', result);
  assert(out.includes('Adapters: builtin'));
  assert(out.includes('Findings: 3'));
  assert(out.includes('Severity: high=1 medium=1 low=1'));
  assert(out.includes('Top findings:'));
  assert(out.includes('[HIGH] r1'));
}

function testFormatSummaryFallbackToHuman() {
  const result = { ok: true, stats: { files: 5 } };
  const out = formatSummary('unknown-cmd', result);
  assert(out.includes('"files": 5'), 'unknown command should fallback to human JSON format');
}

function testFormatSummaryMissingCommands() {
  const statsResult = { ok: true, stats: { files: 10, imports: 20 } };
  const statsOut = formatSummary('stats', statsResult);
  assert(statsOut.includes('files: 10'), `stats summary should include key stats, got: ${statsOut}`);
  assert(statsOut.includes('imports: 20'), `stats summary should include imports, got: ${statsOut}`);

  const depsResult = { ok: true, file: 'src/a.js', dependenciesCount: 2, dependencies: ['src/b.js', 'src/c.js'] };
  const depsOut = formatSummary('dependencies', depsResult);
  assert(depsOut.includes('Dependencies: 2'), `dependencies summary, got: ${depsOut}`);
  assert(depsOut.includes('src/b.js'), `dependencies summary should list files, got: ${depsOut}`);

  const dpsResult = { ok: true, file: 'src/a.js', dependentsCount: 1, dependents: ['src/b.js'] };
  const dpsOut = formatSummary('dependents', dpsResult);
  assert(dpsOut.includes('Dependents: 1'), `dependents summary, got: ${dpsOut}`);

  const deadResult = { ok: true, deadExportsCount: 1, deadExports: [{ file: 'a.js', exports: ['x'] }] };
  const deadOut = formatSummary('dead-exports', deadResult);
  assert(deadOut.includes('Dead exports: 1'), `dead-exports summary, got: ${deadOut}`);
  assert(deadOut.includes('a.js: x'), `dead-exports summary should list files, got: ${deadOut}`);

  const unresResult = { ok: true, unresolvedCount: 1, unresolved: [{ file: 'a.js', import: './missing' }] };
  const unresOut = formatSummary('unresolved', unresResult);
  assert(unresOut.includes('Unresolved: 1'), `unresolved summary, got: ${unresOut}`);
  assert(unresOut.includes('a.js: ./missing'), `unresolved summary should list files, got: ${unresOut}`);

  const cyclesResult = { ok: true, cyclesCount: 1, cycles: [['a.js', 'b.js', 'a.js']] };
  const cyclesOut = formatSummary('cycles', cyclesResult);
  assert(cyclesOut.includes('Cycles: 1'), `cycles summary, got: ${cyclesOut}`);
  assert(cyclesOut.includes('a.js -> b.js -> a.js'), `cycles summary should list cycles, got: ${cyclesOut}`);

  const treeResult = { ok: true, file: 'src/a.js', tree: { imports: [{ file: 'src/b.js' }], dependents: [{ file: 'src/c.js' }] } };
  const treeOut = formatSummary('tree', treeResult);
  assert(treeOut.includes('File: src/a.js'), `tree summary, got: ${treeOut}`);
  assert(treeOut.includes('Imports: 1'), `tree summary imports, got: ${treeOut}`);
  assert(treeOut.includes('Dependents: 1'), `tree summary dependents, got: ${treeOut}`);

  const wsResult = { ok: true, workspaceRoot: '/project', detected: { node: true, python: false } };
  const wsOut = formatSummary('workspace-info', wsResult);
  assert(wsOut.includes('Workspace: /project'), `workspace-info summary, got: ${wsOut}`);
  assert(wsOut.includes('node'), `workspace-info summary should list detected, got: ${wsOut}`);

  const diagResult = { ok: true, checksRun: 5, failedChecks: ['lint'], diagnosticsSummary: { total: 3 } };
  const diagOut = formatSummary('diagnostics', diagResult);
  assert(diagOut.includes('Checks: 5'), `diagnostics summary checks, got: ${diagOut}`);
  assert(diagOut.includes('Diagnostics: 3'), `diagnostics summary total, got: ${diagOut}`);

  const mapResult = { ok: true, tree: [{ type: 'file', name: 'a.js', path: 'a.js' }], edges: [], issueOverlay: { deadExports: [], unresolved: [], cycles: [] } };
  const mapOut = formatSummary('audit-map', mapResult);
  assert(mapOut.includes('Files: 1'), `audit-map summary files, got: ${mapOut}`);
  assert(mapOut.includes('Edges: 0'), `audit-map summary edges, got: ${mapOut}`);
}

function testFormatSummaryError() {
  assert.strictEqual(formatSummary('any', { ok: false, error: 'boom' }), 'Error: boom');
  assert.strictEqual(formatSummary('any', null), 'Error: Command failed');
}

function testFormatMarkdownAuditSummary() {
  const result = {
    ok: true,
    scope: { counts: { totalFiles: 10, mainlineFiles: 6 } },
    summary: { severity: 'medium', nextSteps: ['Step A', 'Step B'], analysisCoverage: { parsedFiles: 10, totalFiles: 10, coverageRatio: 1 } },
    health: { healthScore: '4/5' },
    deadExports: { deadExportsCount: 2 },
    unresolved: { unresolvedCount: 1 },
    cycles: { cyclesCount: 0 },
  };
  const out = formatMarkdown('audit-summary', result);
  assert(out.includes('# Audit Summary'));
  assert(out.includes('**Severity**: medium'));
  assert(out.includes('**Health**: 4/5'));
  assert(out.includes('**Files**: 10 total, 6 mainline'));
  assert(out.includes('**Issues**: 2 dead exports, 1 unresolved, 0 cycles'));
  assert(out.includes('## Next Steps'));
  assert(out.includes('- Step A'));
}

function testFormatMarkdownAuditSecurity() {
  const result = {
    ok: true,
    adapters: ['builtin'],
    summary: { total: 2, bySeverity: { high: 1, medium: 1, low: 0 } },
    findings: [
      { severity: 'high', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm1' },
      { severity: 'medium', ruleId: 'r2', file: 'b.js', lineStart: 2, message: 'm2' },
    ],
  };
  const out = formatMarkdown('audit-security', result);
  assert(out.includes('# Security Audit'));
  assert(out.includes('**Adapters**: builtin'));
  assert(out.includes('**Findings**: 2'));
  assert(out.includes('## Findings'));
  assert(out.includes('`r1`'));
  assert(out.includes('`r2`'));
}

function testFormatMarkdownFallbackToHuman() {
  const result = { ok: true, stats: { files: 5 } };
  const out = formatMarkdown('stats', result);
  assert(out.includes('**files**: 5'));
}

function testFormatMarkdownError() {
  assert.strictEqual(formatMarkdown('any', { ok: false, error: 'boom' }), '## Error\n\nboom');
  assert.strictEqual(formatMarkdown('any', null), '## Error\n\nCommand failed');
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

// ---------------------------------------------------------------------------
// formatJsonl
// ---------------------------------------------------------------------------

function testFormatJsonlError() {
  const out = formatJsonl('audit-security', { ok: false, error: 'fail' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed._type, 'error');
  assert.strictEqual(parsed.error, 'fail');
}

function testFormatJsonlAuditSecurity() {
  const result = {
    ok: true,
    findings: [
      { severity: 'high', ruleId: 'eval', file: 'a.js', lineStart: 1 },
      { severity: 'low', ruleId: 'log', file: 'b.js', lineStart: 2 },
    ],
  };
  const lines = formatJsonl('audit-security', result).split('\n');
  assert.strictEqual(lines.length, 2, 'should emit one line per finding');
  const first = JSON.parse(lines[0]);
  assert.strictEqual(first._type, 'finding');
  assert.strictEqual(first.ruleId, 'eval');
}

function testFormatJsonlDeadExports() {
  const result = {
    ok: true,
    deadExports: [
      { file: 'a.js', exports: ['foo'], confidence: 'medium' },
    ],
  };
  const lines = formatJsonl('dead-exports', result).split('\n');
  assert.strictEqual(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.strictEqual(row._type, 'dead-export');
  assert.strictEqual(row.file, 'a.js');
}

function testFormatJsonlAuditSummary() {
  const result = {
    ok: true,
    summary: { severity: 'medium' },
    scope: { counts: { totalFiles: 10 } },
    deadExports: { deadExportsCount: 1, deadExports: [{ file: 'a.js', name: 'foo' }] },
    unresolved: { unresolvedCount: 1, unresolved: [{ file: 'b.js', source: 'x' }] },
    cycles: { cyclesCount: 1, cycles: [{ files: ['a.js', 'b.js'], length: 2 }] },
    orphans: { counts: { total: 1 }, samples: { modules: ['orphan.js'] } },
    hotspots: [{ file: 'hot.js', score: 99, risk: 'high' }],
    knowledgeRisk: { high: [{ file: 'risk.js', riskLevel: 'high' }], medium: [] },
  };
  const lines = formatJsonl('audit-summary', result).split('\n');
  assert.strictEqual(lines.length, 7, 'should emit summary + 6 record types');
  const first = JSON.parse(lines[0]);
  assert.strictEqual(first._type, 'summary');
  assert.strictEqual(first.totalFiles, 10);
  assert.strictEqual(first.deadExports, 1);
  const types = lines.map((l) => JSON.parse(l)._type);
  assert(types.includes('hotspot'));
  assert(types.includes('dead-export'));
  assert(types.includes('unresolved'));
  assert(types.includes('cycle'));
  assert(types.includes('orphan'));
  assert(types.includes('knowledge-risk'));
}

function testFormatJsonlEmptyResult() {
  const result = { ok: true, severity: 'low', findings: [] };
  const lines = formatJsonl('audit-security', result).split('\n');
  assert.strictEqual(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.strictEqual(row._type, 'summary');
  assert.strictEqual(row.severity, 'low');
}

// ---------------------------------------------------------------------------
// formatAi
// ---------------------------------------------------------------------------

function makeAiResult(overrides = {}) {
  return {
    ok: true,
    workspaceRoot: '/project',
    schemaVersion: '1.2.0',
    scope: { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } },
    summary: {
      severity: 'medium',
      counts: { deadExports: 2, unresolved: 1, cycles: 1, missingHygieneChecks: 0 },
      nextSteps: ['Fix cycles first', 'Then unresolved', 'Then dead exports'],
      analysisCoverage: { parsedFiles: 10, totalFiles: 10, coverageRatio: 1.0 },
    },
    health: { healthScore: '4/5', healthScoreNumeric: { passed: 4, total: 5, ratio: 0.8 }, fixes: [{ check: 'dockerConfig' }] },
    deadExports: {
      deadExportsCount: 2,
      deadExports: [
        { file: 'a.js', exports: ['foo'], confidence: 'medium' },
        { file: 'b.js', exports: ['bar'], confidence: 'low' },
      ],
      possibleFalsePositives: { count: 0, total: 2 },
    },
    unresolved: {
      unresolvedCount: 1,
      unresolved: [{ file: 'c.js', import: 'x' }],
      possibleFalsePositives: { count: 0, total: 1 },
    },
    cycles: {
      cyclesCount: 1,
      cycles: [{ files: ['a.js', 'b.js', 'a.js'], length: 2 }],
    },
    ...overrides,
  };
}

function testFormatAiAuditSummarySurface() {
  const result = makeAiResult();
  const out = JSON.parse(formatAi('audit-summary', result, { depth: 'surface' }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.severity, 'medium');
  assert.strictEqual(out.counts.deadExports, 2);
  assert.strictEqual(out.counts.unresolved, 1);
  assert.strictEqual(out.counts.cycles, 1);
  assert(out.topRisks.length >= 1, 'should have top risks');
  assert.strictEqual(out.topRisks[0].category, 'cycles', 'top risk should be cycles');
  assert.strictEqual(out.actions, undefined, 'surface should not include actions');
  assert.strictEqual(out.confidence, undefined, 'surface should not include confidence');
  assert.strictEqual(out.meta, undefined, 'surface should not include meta');
  assert.strictEqual(out.riskFiles, undefined, 'surface should not include riskFiles');
  assert.strictEqual(out.details, undefined, 'surface should not include details');
  // Verify token economy: surface should be small (< ~600 chars ≈ 150 tokens)
  const json = formatAi('audit-summary', result, { depth: 'surface' });
  assert(json.length < 600, `surface output too large: ${json.length} chars`);
}

function testFormatAiAuditSummaryDetail() {
  const result = makeAiResult();
  const out = JSON.parse(formatAi('audit-summary', result, { depth: 'detail' }));
  assert.strictEqual(out.ok, true);
  assert(out.riskFiles, 'detail should include riskFiles');
  assert(Array.isArray(out.riskFiles.deadExports), 'detail should include deadExports riskFiles');
  assert.strictEqual(out.riskFiles.deadExports.length, 2);
  assert.strictEqual(out.details, undefined, 'detail should not include full details');
}

function testFormatAiAuditSummaryFull() {
  const result = makeAiResult();
  const out = JSON.parse(formatAi('audit-summary', result, { depth: 'full' }));
  assert.strictEqual(out.ok, true);
  assert(out.details, 'full should include details');
  assert(Array.isArray(out.details.deadExports), 'full should include deadExports details');
  assert.strictEqual(out.details.deadExports.length, 2);
}

function testFormatAiTokenBudgetDowngrade() {
  const result = makeAiResult();
  // Force a very low token budget to trigger downgrade to core fields
  const out = JSON.parse(formatAi('audit-summary', result, { depth: 'full', tokenBudget: 10 }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.severity, 'medium');
  assert.strictEqual(out.counts.deadExports, 2);
  // After aggressive stripping, topRisks and actions should be gone
  assert.strictEqual(out.topRisks, undefined, 'over-budget should strip topRisks');
  assert.strictEqual(out.actions, undefined, 'over-budget should strip actions');
}

function testFormatAiFallbackToSummary() {
  const result = { ok: true, summary: { total: 0 } };
  const out = formatAi('audit-security', result);
  // Non audit-summary commands fallback to formatSummary
  assert(out.includes('Findings: 0') || out.includes('Adapters:'), 'fallback should use summary format');
}

function testFormatAiError() {
  const out = JSON.parse(formatAi('audit-summary', { ok: false, error: 'boom' }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error, 'boom');
}

function testFormatAiWithWarnings() {
  const result = makeAiResult({
    warnings: [
      { type: 'regex-fallback', severity: 'medium', files: 3, message: '3 files fell back to regex' },
    ],
  });
  // Warnings are preserved in detail/full but stripped in surface to stay under token budget
  const detailOut = JSON.parse(formatAi('audit-summary', result, { depth: 'detail' }));
  assert(Array.isArray(detailOut.warnings), 'detail should include warnings array');
  assert.strictEqual(detailOut.warnings.length, 1);
  assert.strictEqual(detailOut.warnings[0].type, 'regex-fallback');
  const surfaceOut = JSON.parse(formatAi('audit-summary', result, { depth: 'surface' }));
  assert.strictEqual(surfaceOut.warnings, undefined, 'surface should strip warnings to stay under budget');
}

// ---------------------------------------------------------------------------
// buildCompositeRisk
// ---------------------------------------------------------------------------

function testBuildCompositeRiskLow() {
  const result = buildCompositeRisk({});
  assert.strictEqual(result.level, 'low');
  assert.strictEqual(result.score, 0);
  assert(result.reasons.some((r) => r.includes('Low observed')));
}

function testBuildCompositeRiskHighImpact() {
  const result = buildCompositeRisk({ impactCount: 12 });
  assert.strictEqual(result.score, 5); // +4 large impact +1 no mapped tests
  assert(result.reasons.some((r) => r.includes('Large impact radius')));
  assert(result.reasons.some((r) => r.includes('No mapped tests')));
}

function testBuildCompositeRiskWithTests() {
  const result = buildCompositeRisk({ impactCount: 1, affectedTestsCount: 4 });
  assert.strictEqual(result.score, 2);
  assert(result.reasons.some((r) => r.includes('Many mapped tests affected')));
}

function testBuildCompositeRiskHistoryRisk() {
  const result = buildCompositeRisk({ historyRisk: { score: 7 } });
  assert.strictEqual(result.score, 2);
  assert(result.reasons.some((r) => r.includes('History risk is high')));
}

function testBuildCompositeRiskFileFallback() {
  const result = buildCompositeRisk({ symbolImpact: { mode: 'file-fallback' } });
  assert.strictEqual(result.score, 1);
  assert(result.reasons.some((r) => r.includes('fell back')));
}

function testBuildCompositeRiskNonMainlineDowngrade() {
  const result = buildCompositeRisk({ impactCount: 5, classification: { isMainline: false } });
  assert.strictEqual(result.score, 3); // +3 broad +1 no tests -1 downgrade = 3
  assert(result.reasons.some((r) => r.includes('Non-mainline')));
}

function testBuildCompositeRiskFunctionScoped() {
  const result = buildCompositeRisk({
    symbolImpact: {
      mode: 'function-symbol',
      changedFunctionImpact: {
        mode: 'function-symbol',
        changedFunctions: ['foo'],
        impactedFunctionDependents: [],
        functionLevelAffectedTests: { affectedTestsCount: 0 },
        impactedDependentCount: 0,
      },
    },
  });
  assert(result.score >= 0);
  assert(result.reasons.some((r) => r.includes('Function-scoped')));
}

// ---------------------------------------------------------------------------
// buildAuditDiffSummary & classifyChangeType
// ---------------------------------------------------------------------------

function testBuildAuditDiffSummaryEmpty() {
  const result = buildAuditDiffSummary([], null, 'unknown');
  assert.strictEqual(result.severity, 'low');
  assert.strictEqual(result.counts.changedFiles, 0);
  assert.strictEqual(result.counts.mainlineChangedFiles, 0);
  assert.deepStrictEqual(result.fileTypeBreakdown, {});
  assert(result.nextSteps.length > 0);
}

function testBuildAuditDiffSummaryWithEntries() {
  const entries = [
    { file: 'src/a.js', impactCount: 5, affectedTestsCount: 2, affectedTests: [{ file: 'test/a.test.js' }], classification: { isMainline: true, fileRole: 'library' }, compositeRisk: { score: 3, level: 'medium', reasons: ['reason'] }, historyRisk: { score: 4, level: 'medium' } },
    { file: 'src/b.js', impactCount: 12, affectedTestsCount: 0, affectedTests: [], classification: { isMainline: true, fileRole: 'library' }, compositeRisk: { score: 6, level: 'high', reasons: ['reason'] }, historyRisk: { score: 7, level: 'high' } },
    { file: 'README.md', classification: { isMainline: false, fileRole: 'docs' } },
  ];
  const result = buildAuditDiffSummary(entries, { totalAdditions: 20, totalDeletions: 5 }, 'node-first');
  assert.strictEqual(result.severity, 'high');
  assert.strictEqual(result.counts.changedFiles, 3);
  assert.strictEqual(result.counts.mainlineChangedFiles, 2);
  assert.strictEqual(result.counts.affectedTests, 1);
  assert.strictEqual(result.counts.maxImpact, 12);
  assert.strictEqual(result.counts.highHistoryRiskFiles, 1);
  assert.strictEqual(result.counts.highCompositeRiskFiles, 1);
  assert(result.topCompositeRisks.length > 0);
  assert(result.nextSteps.some((s) => s.includes('linter')));
  assert(result.nextSteps.some((s) => s.includes('non-mainline')));
}

function testClassifyChangeTypeDocsMajority() {
  const entries = [
    { file: 'README.md', classification: { isMainline: true, fileRole: 'docs' } },
    { file: 'CHANGELOG.md', classification: { isMainline: true, fileRole: 'docs' } },
    { file: 'LICENSE', classification: { isMainline: true, fileRole: 'docs' } },
  ];
  assert.strictEqual(classifyChangeType(entries), 'docs');
}

function testClassifyChangeTypeCodeMajority() {
  const entries = [
    { file: 'src/a.js', classification: { isMainline: true, fileRole: 'library' } },
    { file: 'src/b.js', classification: { isMainline: true, fileRole: 'entry' } },
    { file: 'README.md', classification: { isMainline: true, fileRole: 'docs' } },
  ];
  assert.strictEqual(classifyChangeType(entries), 'code');
}

function testClassifyChangeTypeTestMajority() {
  const entries = [
    { file: 'test/a.test.js', classification: { isMainline: true, fileRole: 'test' } },
    { file: 'test/b.test.js', classification: { isMainline: true, fileRole: 'test' } },
    { file: 'src/a.js', classification: { isMainline: true, fileRole: 'library' } },
  ];
  assert.strictEqual(classifyChangeType(entries), 'tests');
}

function testClassifyChangeTypeConfigMajority() {
  const entries = [
    { file: 'tsconfig.json', classification: { isMainline: true, fileRole: 'config' } },
    { file: 'package.json', classification: { isMainline: true, fileRole: 'config' } },
    { file: 'src/a.js', classification: { isMainline: true, fileRole: 'library' } },
  ];
  assert.strictEqual(classifyChangeType(entries), 'config');
}

function testClassifyChangeTypeReferenceArchive() {
  const entries = [
    { file: 'archive/old.js', classification: { isMainline: false, fileRole: 'library', directoryRole: 'archive' } },
    { file: 'ref/legacy.js', classification: { isMainline: false, fileRole: 'library', directoryRole: 'reference' } },
  ];
  assert.strictEqual(classifyChangeType(entries), 'docs');
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
  testFormatHumanTree();

  testFormatSummaryAuditSummary();
  testFormatSummaryAuditSecurity();
  testFormatSummaryMissingCommands();
  testFormatSummaryFallbackToHuman();
  testFormatSummaryError();

  testFormatMarkdownAuditSummary();
  testFormatMarkdownAuditSecurity();
  testFormatMarkdownFallbackToHuman();
  testFormatMarkdownError();

  testBuildRepoSummaryBasic();
  testBuildRepoSummaryCoverageWarning();
  testBuildRepoSummaryNodeStack();
  testBuildRepoSummaryJavaStack();
  testBuildRepoSummaryNoNonMainline();

  testFormatJsonlError();
  testFormatJsonlAuditSecurity();
  testFormatJsonlDeadExports();
  testFormatJsonlAuditSummary();
  testFormatJsonlEmptyResult();

  testFormatAiAuditSummarySurface();
  testFormatAiAuditSummaryDetail();
  testFormatAiAuditSummaryFull();
  testFormatAiTokenBudgetDowngrade();
  testFormatAiFallbackToSummary();
  testFormatAiError();
  testFormatAiWithWarnings();
  testCrossFormatCoverage();

  testBuildCompositeRiskLow();
  testBuildCompositeRiskHighImpact();
  testBuildCompositeRiskWithTests();
  testBuildCompositeRiskHistoryRisk();
  testBuildCompositeRiskFileFallback();
  testBuildCompositeRiskNonMainlineDowngrade();
  testBuildCompositeRiskFunctionScoped();

  testBuildAuditDiffSummaryEmpty();
  testBuildAuditDiffSummaryWithEntries();
  testClassifyChangeTypeDocsMajority();
  testClassifyChangeTypeCodeMajority();
  testClassifyChangeTypeTestMajority();
  testClassifyChangeTypeConfigMajority();
  testClassifyChangeTypeReferenceArchive();

}

function testCrossFormatCoverage() {
  const assertIncludes = (actual, expected, msg) => {
    assert(actual.includes(expected), `${msg}: expected to include "${expected}", got: ${actual.substring(0, 200)}`);
  };

  const cases = [
    { cmd: 'audit-overview', r: { ok: true, workspaceRoot: '/project', summary: { severity: 'low', recommendations: ['Rec1'] }, skeleton: { totalFiles: 20, mainlineFiles: 15 }, aggregates: { hotspotsByRisk: { high: 1, medium: 0 }, stabilityCounts: { fragile: 0 } }, orphans: { counts: { total: 0 }, samples: { modules: ['c.js'] } }, languageSupport: { js: { level: 'ast', confidence: 'high' } }, hotspots: [{ file: 'a.js' }], stability: [{ file: 'b.js' }] }, h: ['totalFiles: 20'], s: ['Severity: low'], m: ['# Project Overview'], a: ['"command": "audit-overview"'], j: ['"_type":"hotspot"'] },
    { cmd: 'audit-diff', r: { ok: true, workspaceRoot: '/project', summary: { severity: 'medium', counts: { changedFiles: 2, mainlineChangedFiles: 1, affectedTests: 3, maxImpact: 2, highHistoryRiskFiles: 0, highCompositeRiskFiles: 1, fileTypeBreakdown: { js: 2 }, changeMetrics: { totalAdditions: 10, totalDeletions: 5 } } }, changedFiles: [{ file: 'a.js', compositeRisk: { score: 0.8, level: 'high' } }], validationAdvice: { phases: ['lint'], topRiskActions: [{ file: 'a.js', actions: ['run tests'], suggestedCommand: 'npm test' }] }, incremental: true, incrementalFindings: { deadExportsCount: 0, unresolvedCount: 0, cyclesCount: 0, deadExports: [], unresolved: [], cycles: [] } }, h: ['changedFiles: 2'], s: ['Severity: medium'], m: ['# Diff Audit'], a: ['"command": "audit-diff"', '"diff-risk"'], j: ['"_type":"changed-file"'] },
    { cmd: 'audit-file', r: { ok: true, file: 'src/foo.js', resolvedPath: '/p/src/foo.js', summary: { severity: 'medium' }, impact: { impactCount: 3, impact: [{ file: 'b.js', level: 1 }] }, affectedTests: { affectedTestsCount: 1, affectedTests: [{ file: 't.js', distance: 1 }] } }, h: ['file: src/foo.js'], s: ['File: src/foo.js'], m: ['# File Audit: src/foo.js'], a: ['"command": "audit-file"', '"impact": 3'], j: ['"_type":"audit-file"'] },
    { cmd: 'health', r: { ok: true, workspaceRoot: '/project', healthScore: '5/5', healthScoreNumeric: { passed: 5, total: 5 }, packageManager: 'npm', checks: { ci: { found: true }, testConfig: { found: true, frameworks: ['jest'] }, readme: { found: true }, license: { found: true }, gitignore: { found: true }, editorconfig: { found: true }, envExample: { found: true }, dockerConfig: { found: false } }, fixes: [{ check: 'dockerConfig', action: 'Add Dockerfile', severity: 'low' }] }, h: ['healthScore: 5/5'], s: ['Health: 5/5'], m: ['# Health Check'], a: ['"command": "health"'], j: ['"ok":true'] },
    { cmd: 'impact', r: { ok: true, impactCount: 2, impact: [{ level: 1, file: 'b.js', via: ['a.js', 'b.js'] }, { level: 2, file: 'c.js' }] }, h: ['impactCount: 2'], s: ['Impact radius: 2'], m: ['# Impact Radius'], a: ['"command": "impact"', '"impact": 2'], j: ['"_type":"impact"'] },
    { cmd: 'affected-tests', r: { ok: true, affectedTestsCount: 1, affectedTests: [{ distance: 1, file: 'test/a.test.js', via: ['src/a.js'] }] }, h: ['affectedTestsCount: 1'], s: ['Affected tests: 1'], m: ['# Affected Tests'], a: ['"command": "affected-tests"', '"tests"'], j: ['"_type":"affected-test"'] },
    { cmd: 'affected-routes', r: { ok: true, routesCount: 1, routes: [{ entry: 'entry.js', path: ['entry.js', 'controller.js', 'service.js'], depth: 3 }] }, h: ['routesCount: 1'], s: ['Routes: 1'], m: ['# Affected Routes'], a: ['"command": "affected-routes"', '"routes"'], j: ['"_type":"route"'] },
    { cmd: 'workspace-info', r: { ok: true, workspaceRoot: '/project', detected: { node: true, python: false } }, h: ['workspaceRoot: /project'], s: ['Workspace: /project'], m: ['workspaceRoot: /project'], a: ['"command": "workspace-info"'], j: ['"ok":true'] },
    { cmd: 'diagnostics', r: { ok: true, checksRun: 5, failedChecks: ['lint'], diagnosticsSummary: { total: 3 }, results: [{ file: 'a.js', messages: 2 }] }, h: ['checksRun: 5'], s: ['Checks: 5'], m: ['checksRun: 5'], a: ['"command": "diagnostics"'], j: ['"_type":"diagnostic"'] },
    { cmd: 'audit-map', r: { ok: true, summary: { severity: 'low', nextSteps: ['Check'] }, tree: [{ type: 'file', name: 'a.js', path: 'a.js' }], edges: [{ source: 'a.js', target: 'b.js' }], highlightedFiles: [{ file: 'a.js', reason: 'hotspot' }], issueOverlay: { unresolved: [], cycles: [], deadExports: [], orphans: [], hotspots: [] } }, h: ['severity: low'], s: ['Files: 1'], m: ['severity: low'], a: ['"command": "audit-map"'], j: ['"_type":"highlighted-file"'] },
    { cmd: 'stats', r: { ok: true, stats: { files: 10, imports: 20 } }, h: ['files: 10'], s: ['files: 10'], m: ['**files**: 10'], a: ['"command": "stats"'], j: ['"ok":true'] },
    { cmd: 'dependencies', r: { ok: true, file: 'src/a.js', dependenciesCount: 2, dependencies: ['src/b.js', 'src/c.js'] }, h: ['dependenciesCount: 2'], s: ['Dependencies: 2'], m: ['dependenciesCount: 2'], a: ['"command": "dependencies"'], j: ['"_type":"dependency"'] },
    { cmd: 'dependents', r: { ok: true, file: 'src/a.js', dependentsCount: 1, dependents: ['src/b.js'] }, h: ['dependentsCount: 1'], s: ['Dependents: 1'], m: ['dependentsCount: 1'], a: ['"command": "dependents"'], j: ['"_type":"dependent"'] },
    { cmd: 'dead-exports', r: { ok: true, deadExportsCount: 1, deadExports: [{ file: 'a.js', exports: ['x'] }], possibleFalsePositives: { disclaimer: 'May be false.' } }, h: ['deadExportsCount: 1'], s: ['Dead exports: 1'], m: ['deadExportsCount: 1'], a: ['"command": "dead-exports"', '"dead-exports"'], j: ['"_type":"dead-export"'] },
    { cmd: 'unresolved', r: { ok: true, unresolvedCount: 1, unresolved: [{ file: 'a.js', import: './missing' }], possibleFalsePositives: { disclaimer: 'May be alias.' } }, h: ['unresolvedCount: 1'], s: ['Unresolved: 1'], m: ['unresolvedCount: 1'], a: ['"command": "unresolved"'], j: ['"_type":"unresolved"'] },
    { cmd: 'cycles', r: { ok: true, cyclesCount: 1, cycles: [['a.js', 'b.js', 'a.js']] }, h: ['cyclesCount: 1'], s: ['Cycles: 1'], m: ['cyclesCount: 1'], a: ['"command": "cycles"', '"cycles"'], j: ['"_type":"cycle"'] },
    { cmd: 'tree', r: { ok: true, file: 'src/a.js', tree: { file: 'src/a.js', imports: [{ file: 'src/b.js' }], dependents: [{ file: 'src/c.js' }] } }, h: ['file: src/a.js'], s: ['File: src/a.js'], m: ['file: src/a.js'], a: ['"command": "tree"'], j: ['"_type":"tree"'] },
    { cmd: 'audit-security', r: { ok: true, adapters: ['builtin'], summary: { total: 2, bySeverity: { high: 1, medium: 1, low: 0 } }, findings: [{ severity: 'high', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm1' }, { severity: 'medium', ruleId: 'r2', file: 'b.js', lineStart: 2, message: 'm2' }] }, h: ['findings: 2'], s: ['Findings: 2'], m: ['# Security Audit'], a: ['"command": "audit-security"', '"security"'], j: ['"_type":"finding"'] },
  ];

  for (const c of cases) {
    if (c.h) { const o = formatHuman(c.cmd, c.r); for (const e of c.h) assertIncludes(o, e, `${c.cmd}/human`); }
    if (c.s) { const o = formatSummary(c.cmd, c.r); for (const e of c.s) assertIncludes(o, e, `${c.cmd}/summary`); }
    if (c.m) { const o = formatMarkdown(c.cmd, c.r); for (const e of c.m) assertIncludes(o, e, `${c.cmd}/markdown`); }
    if (c.a) { const o = formatAi(c.cmd, c.r); for (const e of c.a) assertIncludes(o, e, `${c.cmd}/ai`); }
    if (c.j) { const o = formatJsonl(c.cmd, c.r); for (const e of c.j) assertIncludes(o, e, `${c.cmd}/jsonl`); }
  }
}

main();
