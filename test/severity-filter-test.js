const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.resolve(__dirname, '..');

function run(args) {
  return spawnSync('node', ['cli.js', ...args, '--json', '--quiet'], { cwd, encoding: 'utf8' });
}

function testAuditSummarySeverityHigh() {
  const result = run(['audit-summary', '--severity', 'high']);
  assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.deadExports.deadExportsCount, 0, 'high severity filter should exclude medium-confidence dead exports');
}

function testAuditSummarySeverityMedium() {
  // Get total unfiltered count first so the test does not break when
  // new dead exports are added to the codebase.
  const unfiltered = run(['audit-summary']);
  assert.ok(unfiltered.status === 0);
  const totalData = JSON.parse(unfiltered.stdout);
  const totalCount = totalData.deadExports.deadExportsCount;

  const result = run(['audit-summary', '--severity', 'medium']);
  assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(
    data.deadExports.deadExportsCount,
    totalCount,
    'medium severity filter should include all medium-confidence dead exports'
  );
}

function testInvalidSeverityValue() {
  const result = spawnSync('node', ['cli.js', 'audit-security', '--severity', 'invalid'], { cwd, encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0, 'invalid severity should exit non-zero');
  assert(result.stderr.includes('Invalid --severity value'), `stderr should contain error message, got: ${result.stderr}`);
}

function testAuditSecuritySeverityFilter() {
  const tmpFile = path.join(cwd, 'test-severity-temp.js');
  try {
    fs.writeFileSync(tmpFile, `eval('1');\nconsole.log(password);\n`);
    const result = run(['audit-security', '--builtin-only', '--severity', 'high']);
    assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
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
  console.log('severity-filter-test.js: all passed');
}

main();
