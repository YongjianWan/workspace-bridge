const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const baselineFile = path.join(cwd, 'test-regression-baseline.json');

function run(args) {
  return spawnSync('node', ['cli.js', ...args, '--json', '--quiet'], { cwd, encoding: 'utf8' });
}

function cleanup() {
  try { fs.unlinkSync(baselineFile); } catch {}
  try { fs.unlinkSync(path.join(cwd, '.workspace-bridge-baseline.json')); } catch {}
}

function testSaveBaseline() {
  cleanup();
  const result = run(['audit-summary', '--save', 'test-regression-baseline.json']);
  assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.baselineSaved, baselineFile, 'should report saved path');
  assert(fs.existsSync(baselineFile), 'baseline file should exist');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  assert(baseline.findings, 'baseline should have findings');
  assert(baseline.timestamp, 'baseline should have timestamp');
  assert.strictEqual(baseline.schemaVersion, '1.2.0', 'baseline should have schemaVersion');
}

function testCheckRegressionNoBaseline() {
  cleanup();
  const result = run(['audit-summary', '--check-regression']);
  assert.ok(result.status === 1, `Exit code should be 1 (ok=false), got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, false, 'should fail when no baseline exists');
  assert(data.regression.error.includes('Failed to load baseline'), 'should report missing baseline');
}

function testCheckRegressionWithBaseline() {
  cleanup();
  // First save a baseline
  const saveResult = run(['audit-summary', '--save', 'test-regression-baseline.json']);
  assert.ok(saveResult.status === 0);

  // Then check regression against it
  const result = run(['audit-summary', '--check-regression', '--baseline', 'test-regression-baseline.json']);
  assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true, 'regression check should succeed');
  assert(data.regression.regression, 'should have regression breakdown');
  assert(Array.isArray(data.regression.regression.deadExports.open), 'deadExports.open should be array');
  assert(Array.isArray(data.regression.regression.deadExports.new), 'deadExports.new should be array');
  assert(Array.isArray(data.regression.regression.deadExports.fixed), 'deadExports.fixed should be array');
  // Same baseline = no changes
  assert.strictEqual(data.regression.regression.deadExports.new.length, 0, 'no new dead exports against same baseline');
  assert.strictEqual(data.regression.regression.deadExports.fixed.length, 0, 'no fixed dead exports against same baseline');
}

function testSaveAndCheckRegressionDefaultPath() {
  cleanup();
  const saveResult = run(['audit-summary', '--save', 'test-regression-baseline.json']);
  assert.ok(saveResult.status === 0);

  const result = run(['audit-summary', '--check-regression', '--baseline', 'test-regression-baseline.json']);
  assert.ok(result.status === 0);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true);
  assert.strictEqual(data.regression.baselinePath, baselineFile);
}

function testCheckRegressionAgainstCommit() {
  cleanup();
  const result = run(['audit-summary', '--check-regression', '--baseline', 'HEAD~1']);
  assert.ok(result.status === 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true, 'commit baseline check should succeed');
  assert.strictEqual(data.regression.commit, 'HEAD~1', 'should report commit');
  assert(data.regression.regression, 'should have regression breakdown');
  assert(Array.isArray(data.regression.regression.deadExports.new), 'deadExports.new should be array');
  assert(Array.isArray(data.regression.regression.deadExports.legacy), 'deadExports.legacy should be array');
  assert(Array.isArray(data.regression.regression.unresolved.new), 'unresolved.new should be array');
  assert(Array.isArray(data.regression.regression.cycles.new), 'cycles.new should be array');
}

function main() {
  try {
    testSaveBaseline();
    testCheckRegressionNoBaseline();
    testCheckRegressionWithBaseline();
    testSaveAndCheckRegressionDefaultPath();
    testCheckRegressionAgainstCommit();
    console.log('regression-test.js: all passed');
  } finally {
    cleanup();
  }
}

main();
