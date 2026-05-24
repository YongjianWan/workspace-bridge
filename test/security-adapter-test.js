#!/usr/bin/env node
// @slow
const assert = require('assert');
const path = require('path');
const { BaseAdapter } = require('../src/adapters/base');
const { SemgrepAdapter } = require('../src/adapters/semgrep');
const { getAllAdapters, getAvailableAdapters } = require('../src/adapters');
const { auditSecurity, groupBySeverity, dedupeWithinTool } = require('../src/tools/security-tools');

async function main() {
  // --- BaseAdapter interface ---
  const base = new BaseAdapter();
  assert.throws(() => base.name, /Subclass must implement name/);
  assert.throws(() => base.normalizeFinding({}), /Subclass must implement normalizeFinding/);
  assert.rejects(() => base.scan([], {}), /Subclass must implement scan/);

  // --- SemgrepAdapter.normalizeFinding ---
  const semgrep = new SemgrepAdapter();
  assert.strictEqual(semgrep.name, 'semgrep');

  const finding = semgrep.normalizeFinding({
    check_id: 'python.lang.security.eval',
    path: 'src/app.py',
    start: { line: 10 },
    end: { line: 12 },
    extra: { message: 'Avoid eval', metadata: { severity: 'HIGH' } },
  });
  assert.strictEqual(finding.ruleId, 'python.lang.security.eval');
  assert.strictEqual(finding.severity, 'high');
  assert.strictEqual(finding.file, 'src/app.py');
  assert.strictEqual(finding.lineStart, 10);
  assert.strictEqual(finding.tool, 'semgrep');

  // Severity fallback
  const lowFinding = semgrep.normalizeFinding({
    check_id: 'x',
    path: 'a.py',
    start: { line: 1 },
    end: { line: 1 },
    extra: { message: 'm', metadata: { severity: 'INFO' } },
  });
  assert.strictEqual(lowFinding.severity, 'low');

  const unknownSeverity = semgrep.normalizeFinding({
    check_id: 'x',
    path: 'a.py',
    start: { line: 1 },
    end: { line: 1 },
    extra: { message: 'm' },
  });
  assert.strictEqual(unknownSeverity.severity, 'medium');

  // --- SemgrepAdapter.scan with no targets ---
  const noTargetResult = await semgrep.scan([], {});
  assert.deepStrictEqual(noTargetResult.findings, []);
  assert.strictEqual(noTargetResult.summary.total, 0);

  // --- Registry ---
  const all = getAllAdapters();
  assert(all.some((a) => a.name === 'semgrep'));

  // --- groupBySeverity ---
  const grouped = groupBySeverity([
    { severity: 'high' },
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'low' },
    { severity: 'unknown' },
  ]);
  assert.strictEqual(grouped.high, 2);
  assert.strictEqual(grouped.medium, 1);
  assert.strictEqual(grouped.low, 1);
  assert.strictEqual(grouped.unknown, 1);

  // --- dedupeWithinTool ---
  const dupes = [
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
  ];
  const deduped = dedupeWithinTool(dupes);
  assert.strictEqual(deduped.length, 1);

  // --- auditSecurity with no scanners available ---
  const noScannerResult = await auditSecurity({ cwd: process.cwd(), targets: [] }, null);
  assert.strictEqual(noScannerResult.ok, true);
  assert.deepStrictEqual(noScannerResult.adapters, ['builtin']);
  assert.strictEqual(typeof noScannerResult.summary.total, 'number');
  assert.strictEqual(noScannerResult.summary.message, null);
  assert.ok(Array.isArray(noScannerResult.findings), 'builtin scan should return findings array');
  assert.ok(Array.isArray(noScannerResult.scanMeta), 'scanMeta should be present');
  assert.strictEqual(noScannerResult.scanMeta[0]?.name, 'builtin');

  // --- auditSecurity defaults empty targets to ['.'] ---
  const { ADAPTERS } = require('../src/adapters');
  let capturedTargets = null;
  const fakeAdapter = {
    name: 'fake',
    async isAvailable() { return true; },
    async scan(targets) {
      capturedTargets = targets;
      return { findings: [], summary: { total: 0 } };
    },
  };
  ADAPTERS.push(fakeAdapter);
  try {
    await auditSecurity({ cwd: process.cwd(), targets: [] }, null);
    assert.deepStrictEqual(capturedTargets, ['.'], 'Empty targets should default to ["."]');
  } finally {
    const idx = ADAPTERS.indexOf(fakeAdapter);
    if (idx >= 0) ADAPTERS.splice(idx, 1);
  }

  // --- auditSecurity builtinOnly forces builtin scan even when adapters available ---
  const fakeAdapter2 = {
    name: 'fake2',
    async isAvailable() { return true; },
    async scan() {
      return { findings: [{ severity: 'high', ruleId: 'fake', file: 'a.js', lineStart: 1, lineEnd: 1, message: 'm', tool: 'fake2' }], summary: { total: 1 } };
    },
  };
  ADAPTERS.push(fakeAdapter2);
  try {
    const builtinResult = await auditSecurity({ cwd: process.cwd(), targets: [], builtinOnly: true }, null);
    assert.deepStrictEqual(builtinResult.adapters, ['builtin'], 'builtinOnly should skip external adapters');
    assert.strictEqual(builtinResult.scanMeta[0]?.name, 'builtin');
    assert.ok(!builtinResult.findings.some((f) => f.tool === 'fake2'), 'builtinOnly should not include fake adapter findings');
  } finally {
    const idx = ADAPTERS.indexOf(fakeAdapter2);
    if (idx >= 0) ADAPTERS.splice(idx, 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
