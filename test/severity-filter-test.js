// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, assertOk } = require('./test-helpers');

const cwd = path.resolve(__dirname, '..');

function run(args) {
  return runCliRaw([...args, '--json', '--quiet'], { cwd });
}

function testAuditSummarySeverityHigh() {
  const result = run(['audit-summary', '--severity', 'high']);
  assertOk(result, 'severity high should succeed');
  const data = JSON.parse(result.stdout);
  // If dead exports are returned, every single one must be high-confidence.
  // We do not assert a fixed count because the real codebase may legitimately
  // contain high-confidence dead exports.
  const deadExports = data.deadExports?.deadExports || [];
  const allHigh = deadExports.every((d) => d.confidence === 'high');
  assert.ok(allHigh, 'high severity filter should only include high-confidence dead exports');
}

function testAuditSummarySeverityMedium() {
  // Get total unfiltered count first so the test does not break when
  // new dead exports are added to the codebase.
  const unfiltered = run(['audit-summary']);
  assertOk(unfiltered, 'unfiltered audit-summary should succeed');
  const totalData = JSON.parse(unfiltered.stdout);
  const totalCount = totalData.deadExports.deadExportsCount;

  const result = run(['audit-summary', '--severity', 'medium']);
  assertOk(result, 'severity medium should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(
    data.deadExports.deadExportsCount,
    totalCount,
    'medium severity filter should include all medium-confidence dead exports'
  );
}

function testInvalidSeverityValue() {
  const result = runCliRaw(['audit-security', '--severity', 'invalid'], { cwd });
  assert.notStrictEqual(result.status, 0, 'invalid severity should exit non-zero');
  assert(result.stderr.includes('Invalid --severity value'), `stderr should contain error message, got: ${result.stderr}`);

  const resultSummary = runCliRaw(['audit-summary', '--severity', 'invalid'], { cwd });
  assert.notStrictEqual(resultSummary.status, 0, 'invalid severity should exit non-zero for audit-summary');
  assert(resultSummary.stderr.includes('Invalid --severity value'), `stderr should contain error message, got: ${resultSummary.stderr}`);
}

function testAuditSecuritySeverityFilter() {
  const tmpFile = path.join(cwd, 'test-severity-temp.js');
  try {
    fs.writeFileSync(tmpFile, `eval('1');\nconsole.log(password);\n`);
    const result = run(['audit-security', '--builtin-only', '--severity', 'high']);
    assertOk(result, 'audit-security severity filter should succeed');
    const data = JSON.parse(result.stdout);
    const highFindings = data.findings.filter((f) => f.severity === 'high');
    const mediumFindings = data.findings.filter((f) => f.severity === 'medium');
    assert(highFindings.length > 0, 'high severity filter should include high findings');
    assert.strictEqual(data.findings.length, highFindings.length, 'high severity filter should exclude medium/low findings');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function main() {
  testAuditSummarySeverityHigh();
  testAuditSummarySeverityMedium();
  testInvalidSeverityValue();
  testAuditSecuritySeverityFilter();
}

main();
