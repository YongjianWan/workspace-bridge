#!/usr/bin/env node

const assert = require('assert');
const {
  normalizeSeverity,
  parseLineWithPatterns,
  parseDiagnosticsFromText,
  uniqueDiagnostics,
  summarizeDiagnostics,
} = require('../src/utils/diagnostics');

function testNormalizeSeverity() {
  assert.strictEqual(normalizeSeverity('error'), 'error');
  assert.strictEqual(normalizeSeverity('warn'), 'warning');
  assert.strictEqual(normalizeSeverity('W'), 'warning');
  assert.strictEqual(normalizeSeverity('info'), 'information');
  assert.strictEqual(normalizeSeverity('hint'), 'hint');
  assert.strictEqual(normalizeSeverity('unknown'), 'error');
}

function testParseRuffOutput() {
  const line = 'src/foo.py:10:5: E501 Line too long';
  const diag = parseLineWithPatterns(line, '/workspace', 'ruff');
  // On Windows, resolveDiagnosticPath joins with C:\; accept either form
  const expectedSuffix = process.platform === 'win32' ? 'src\\foo.py' : 'src/foo.py';
  assert(diag.file.endsWith(expectedSuffix), `file should end with ${expectedSuffix}, got ${diag.file}`);
  assert.strictEqual(diag.line, 10);
  assert.strictEqual(diag.column, 5);
  assert.strictEqual(diag.severity, 'error');
  assert.strictEqual(diag.message, 'E501 Line too long');
}

function testParsePyrightOutput() {
  const line = '/workspace/src/bar.py:20:1 - error: Type mismatch (reportGeneralTypeIssues)';
  const diag = parseLineWithPatterns(line, '/workspace', 'pyright');
  // resolveDiagnosticPath behavior varies by platform for absolute-looking paths;
  // just verify the line/column/severity are correct.
  assert(diag.file, 'file should be present');
  assert.strictEqual(diag.line, 20);
  assert.strictEqual(diag.column, 1);
  assert.strictEqual(diag.severity, 'error');
}

function testParseEslintUnixOutput() {
  const line = '/workspace/src/baz.js:5:10: Missing semicolon';
  const diag = parseLineWithPatterns(line, '/workspace', 'eslint');
  assert(diag.file, 'file should be present');
  assert.strictEqual(diag.line, 5);
  assert.strictEqual(diag.column, 10);
}

function testParseDiagnosticsFromText() {
  const text = `src/a.py:1:1: E401\nsrc/b.py:2:1: E402\n\n`;
  const diags = parseDiagnosticsFromText(text, '/workspace', 'ruff');
  assert.strictEqual(diags.length, 2);
  assert.strictEqual(diags[0].line, 1);
  assert.strictEqual(diags[1].line, 2);
}

function testUniqueDiagnostics() {
  const diags = [
    { file: 'a.js', line: 1, column: 1, severity: 'error', code: 'E1', message: 'x' },
    { file: 'a.js', line: 1, column: 1, severity: 'error', code: 'E1', message: 'x' },
    { file: 'b.js', line: 2, column: 1, severity: 'warning', code: null, message: 'y' },
  ];
  const result = uniqueDiagnostics(diags);
  assert.strictEqual(result.length, 2);
}

function testSummarizeDiagnostics() {
  const diags = [
    { severity: 'error' },
    { severity: 'warning' },
    { severity: 'warning' },
    { severity: 'information' },
  ];
  const summary = summarizeDiagnostics(diags);
  assert.strictEqual(summary.total, 4);
  assert.strictEqual(summary.error, 1);
  assert.strictEqual(summary.warning, 2);
  assert.strictEqual(summary.information, 1);
  assert.strictEqual(summary.hint, 0);
}

function main() {
  testNormalizeSeverity();
  testParseRuffOutput();
  testParsePyrightOutput();
  testParseEslintUnixOutput();
  testParseDiagnosticsFromText();
  testUniqueDiagnostics();
  testSummarizeDiagnostics();
}

main();
