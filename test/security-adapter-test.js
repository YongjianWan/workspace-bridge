#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { BaseAdapter } = require('../src/adapters/base');
const { SemgrepAdapter } = require('../src/adapters/semgrep');
const { CodeQLAdapter } = require('../src/adapters/codeql');
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
  semgrep.scan([], {}).then((result) => {
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.summary.total, 0);
  });

  // --- CodeQLAdapter.normalizeFinding (SARIF) ---
  const codeql = new CodeQLAdapter();
  assert.strictEqual(codeql.name, 'codeql');

  const sarifFinding = codeql.normalizeFinding({
    ruleId: 'codeql/python/sql-injection',
    message: { text: 'Potential SQL injection' },
    level: 'error',
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'src/db.py' },
        region: { startLine: 15, endLine: 17 },
      },
    }],
  });
  assert.strictEqual(sarifFinding.ruleId, 'codeql/python/sql-injection');
  assert.strictEqual(sarifFinding.severity, 'high');
  assert.strictEqual(sarifFinding.file, 'src/db.py');
  assert.strictEqual(sarifFinding.lineStart, 15);
  assert.strictEqual(sarifFinding.lineEnd, 17);
  assert.strictEqual(sarifFinding.tool, 'codeql');

  // SARIF severity fallback
  const warnFinding = codeql.normalizeFinding({
    ruleId: 'x',
    message: { text: 'warn' },
    level: 'warning',
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'a.py' },
        region: { startLine: 1 },
      },
    }],
  });
  assert.strictEqual(warnFinding.severity, 'medium');

  // SARIF without locations
  const noLoc = codeql.normalizeFinding({
    ruleId: 'y',
    message: { text: 'note' },
    level: 'note',
  });
  assert.strictEqual(noLoc.severity, 'low');
  assert.strictEqual(noLoc.file, '');

  // --- CodeQLAdapter._extractResultsFromSarif ---
  const multiRunSarif = {
    runs: [
      { results: [{ ruleId: 'r1' }] },
      { results: [{ ruleId: 'r2' }, { ruleId: 'r3' }] },
    ],
  };
  const extracted = codeql._extractResultsFromSarif(multiRunSarif);
  assert.strictEqual(extracted.length, 3);
  assert.strictEqual(extracted[0].ruleId, 'r1');

  // Empty SARIF
  assert.deepStrictEqual(codeql._extractResultsFromSarif({}), []);
  assert.deepStrictEqual(codeql._extractResultsFromSarif(null), []);

  // --- CodeQLAdapter.scan with no language detected ---
  // Use 'test/' as cwd because it has no build markers (package.json, go.mod, etc.)
  const noLangResult = await codeql.scan([], { cwd: path.join(process.cwd(), 'test') });
  assert.strictEqual(noLangResult.summary.total, 0);
  assert.ok(noLangResult.summary.error.includes('Unable to detect language'), `Expected language detection error, got: ${noLangResult.summary.error}`);

  // --- CodeQLAdapter.scan multiple languages detected ---
  const fs = require('fs');
  const tmpGoMod = path.join(process.cwd(), 'go.mod');
  fs.writeFileSync(tmpGoMod, 'module fake\n');
  try {
    const multiLangResult = await codeql.scan([], { cwd: process.cwd() });
    assert.strictEqual(multiLangResult.summary.total, 0);
    assert.ok(multiLangResult.summary.error.includes('Multiple languages detected'), `Expected multiple languages error, got: ${multiLangResult.summary.error}`);
  } finally {
    fs.unlinkSync(tmpGoMod);
  }

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

  // --- dedupeWithinTool ---
  const dupes = [
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
    { tool: 'semgrep', ruleId: 'r1', file: 'a.py', lineStart: 1 },
    { tool: 'codeql', ruleId: 'r2', file: 'a.py', lineStart: 1 },
  ];
  const deduped = dedupeWithinTool(dupes);
  assert.strictEqual(deduped.length, 2);

  // --- auditSecurity with no scanners available ---
  const noScannerResult = await auditSecurity({ cwd: process.cwd(), targets: [] }, null);
  assert.strictEqual(noScannerResult.ok, true);
  assert.deepStrictEqual(noScannerResult.adapters, []);
  assert.strictEqual(noScannerResult.summary.total, 0);
  assert.ok(noScannerResult.summary.message.includes('No security scanners available'));

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

  console.log('security-adapter-test: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
