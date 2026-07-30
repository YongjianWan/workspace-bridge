// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, assertOk, makeTempDir, cleanupTempDir } = require('./test-helpers');

const cwd = path.resolve(__dirname, '..');

async function run(args) {
  return await runCliInProcessRaw([...args, '--json', '--quiet'], { cwd });
}

async function testAuditSummarySeverityHigh() {
  const result = await run(['audit-summary', '--severity', 'high']);
  assertOk(result, 'severity high should succeed');
  const data = JSON.parse(result.stdout);
  // If dead exports are returned, every single one must be high-confidence.
  // We do not assert a fixed count because the real codebase may legitimately
  // contain high-confidence dead exports.
  const deadExports = data.deadExports?.deadExports || [];
  const allHigh = deadExports.every((d) => d.confidence === 'high');
  assert.ok(allHigh, 'high severity filter should only include high-confidence dead exports');
}

async function testAuditSummarySeverityMedium() {
  // Get total unfiltered count first so the test does not break when
  // new dead exports are added to the codebase.
  const unfiltered = await run(['audit-summary']);
  assertOk(unfiltered, 'unfiltered audit-summary should succeed');
  const totalData = JSON.parse(unfiltered.stdout);
  const totalCount = totalData.deadExports.deadExportsCount;

  const result = await run(['audit-summary', '--severity', 'medium']);
  assertOk(result, 'severity medium should succeed');
  const data = JSON.parse(result.stdout);
  const mediumCount = data.deadExports.deadExportsCount;

  // Medium filter includes medium+ confidence dead exports, so its count
  // must not exceed the unfiltered count and must not include low-confidence
  // items (the current codebase has one low-confidence dynamic-registry-export).
  assert.ok(
    mediumCount <= totalCount,
    'medium severity count should not exceed unfiltered count'
  );
  const deadExports = data.deadExports?.deadExports || [];
  const noneLow = deadExports.every((d) => d.confidence !== 'low');
  assert.ok(noneLow, 'medium severity filter should not include low-confidence dead exports');
}

async function testInvalidSeverityValue() {
  const result = await runCliInProcessRaw(['audit-security', '--severity', 'invalid'], { cwd });
  assert.notStrictEqual(result.status, 0, 'invalid severity should exit non-zero');
  assert(result.stderr.includes('Invalid --severity value'), `stderr should contain error message, got: ${result.stderr}`);

  const resultSummary = await runCliInProcessRaw(['audit-summary', '--severity', 'invalid'], { cwd });
  assert.notStrictEqual(resultSummary.status, 0, 'invalid severity should exit non-zero for audit-summary');
  assert(resultSummary.stderr.includes('Invalid --severity value'), `stderr should contain error message, got: ${resultSummary.stderr}`);
}

async function testAuditSecuritySeverityFilter() {
  const tempDir = makeTempDir('wb-severity-');
  const tmpFile = path.join(tempDir, 'test-severity-temp.js');
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}'); // Dummy package.json
    fs.writeFileSync(tmpFile, `eval('1');\nconsole.log(password);\n`);
    const result = await runCliInProcessRaw(['audit-security', '--cwd', tempDir, '--builtin-only', '--severity', 'high', '--json', '--quiet'], { cwd: tempDir });
    assertOk(result, 'audit-security severity filter should succeed');
    const data = JSON.parse(result.stdout);
    const highFindings = data.findings.filter((f) => f.severity === 'high');
    assert(highFindings.length > 0, 'high severity filter should include high findings');
    assert.strictEqual(data.findings.length, highFindings.length, 'high severity filter should exclude medium/low findings');
  } finally {
    cleanupTempDir(tempDir);
  }
}

// Snapshot key does not include severity, so a severity-filtered run must
// bypass the 'overview' snapshot BOTH ways — same contract as --category.
// Read side: replaying an unfiltered snapshot must not skip the filter.
// Write side: a filtered run must not store its subset and poison every
// later consumer. Deterministic via fresh --cache-dir per phase.
async function testSeverityFilterAppliesOnSnapshotReplay() {
  const tempCache = makeTempDir('wb-sev-cache-');
  try {
    // Phase 1: fresh cache, plain run → computes unfiltered, stores snapshot
    const plain = await run(['audit-summary', '--cache-dir', tempCache]);
    assertOk(plain, 'plain run should succeed');

    // Phase 2: same cache + --severity high → replays the phase-1 snapshot.
    // The filter must still apply; replay is no excuse for unfiltered data.
    const high = await run(['audit-summary', '--severity', 'high', '--cache-dir', tempCache]);
    assertOk(high, 'severity run on replayed snapshot should succeed');
    const deadExports = JSON.parse(high.stdout).deadExports?.deadExports || [];
    assert.ok(
      deadExports.every((d) => d.confidence === 'high'),
      'severity filter must apply even when the response is a snapshot replay'
    );
  } finally {
    cleanupTempDir(tempCache);
  }
}

async function testSeverityRunMustNotPoisonSnapshot() {
  const tempCache = makeTempDir('wb-sev-poison-');
  try {
    // Phase 1: severity run FIRST on a fresh cache → computes and stores.
    // If it stores its filtered subset under the shared 'overview' key,
    // every later plain consumer is silently undercounted.
    await run(['audit-summary', '--severity', 'high', '--cache-dir', tempCache]);
    // Phase 2: plain run replays whatever phase 1 stored
    const plain = await run(['audit-summary', '--cache-dir', tempCache]);
    assertOk(plain, 'plain run after severity run should succeed');
    const count = JSON.parse(plain.stdout).deadExports.deadExportsCount;
    const deadExports = JSON.parse(plain.stdout).deadExports?.deadExports || [];
    assert.ok(
      count === 0 || deadExports.some((d) => d.confidence !== 'high') || count > deadExports.filter((d) => d.confidence === 'high').length,
      'a severity-filtered run must not leave its subset in the shared snapshot (plain replay must not be severity-shaped)'
    );
  } finally {
    cleanupTempDir(tempCache);
  }
}

async function main() {
  await testAuditSummarySeverityHigh();
  await testAuditSummarySeverityMedium();
  await testInvalidSeverityValue();
  await testAuditSecuritySeverityFilter();
  await testSeverityFilterAppliesOnSnapshotReplay();
  await testSeverityRunMustNotPoisonSnapshot();
}

main();
