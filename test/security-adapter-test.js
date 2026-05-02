#!/usr/bin/env node
const assert = require('assert');
const { BaseAdapter } = require('../src/adapters/base');
const { SemgrepAdapter } = require('../src/adapters/semgrep');
const { CodeQLAdapter } = require('../src/adapters/codeql');
const { getAllAdapters, getAvailableAdapters } = require('../src/adapters');
const { auditSecurity, groupBySeverity, dedupeFindings } = require('../src/tools/security-tools');

function main() {
  // --- BaseAdapter interface ---
  const base = new BaseAdapter();
  assert.throws(() => base.name, /Subclass must implement name/);
  assert.throws(() => base.normalizeFinding({}), /Subclass must implement normalizeFinding/);
  // scan is async; use assert.rejects for async errors
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
  semgrep.scan([], {}).then((result) => {
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.summary.total, 0);
  });

  // --- CodeQLAdapter skeleton ---
  const codeql = new CodeQLAdapter();
  assert.strictEqual(codeql.name, 'codeql');
  codeql.scan([], {}).then((result) => {
    assert.strictEqual(result.summary.error.includes('CodeQL adapter'), true);
  });

  // --- Registry ---
  const all = getAllAdapters();
  assert(all.some((a) => a.name === 'semgrep'));
  assert(all.some((a) => a.name === 'codeql'));

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

  // --- dedupeFindings ---
  const dupes = [
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
    { tool: 'semgrep', ruleId: 'r2', file: 'a.py', lineStart: 1 },
  ];
  const deduped = dedupeFindings(dupes);
  assert.strictEqual(deduped.length, 2);

  // --- auditSecurity with no scanners available ---
  auditSecurity({ cwd: process.cwd(), targets: [] }, null).then((result) => {
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.adapters, []);
    assert.strictEqual(result.summary.total, 0);
    assert.ok(result.summary.message.includes('No security scanners available'));
  });

  console.log('security-adapter-test: ok');
}

main();
