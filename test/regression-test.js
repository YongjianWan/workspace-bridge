// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, runInDir, assertOk, makeTempDir, cleanupTempDir } = require('./test-helpers');

const tempDir = makeTempDir('wb-regression-');
const baselineFile = path.join(tempDir, 'test-regression-baseline.json');

// Initialize a hermetic git repository in tempDir
runInDir('git', ['init'], tempDir);
runInDir('git', ['config', 'user.email', 'test@example.com'], tempDir);
runInDir('git', ['config', 'user.name', 'Test User'], tempDir);

// Commit 1 (HEAD~1)
fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'reg-test', version: '1.0.0', main: 'a.js' }), 'utf8');
fs.writeFileSync(path.join(tempDir, 'a.js'), 'console.log(1);\n', 'utf8');
runInDir('git', ['add', '.'], tempDir);
runInDir('git', ['commit', '-m', 'first commit'], tempDir);

// Commit 2 (HEAD)
fs.writeFileSync(path.join(tempDir, 'a.js'), 'console.log(2);\n', 'utf8');
runInDir('git', ['add', '.'], tempDir);
runInDir('git', ['commit', '-m', 'second commit'], tempDir);

function cleanup() {
  try { fs.unlinkSync(baselineFile); } catch {}
  try { fs.unlinkSync(path.join(tempDir, '.workspace-bridge-baseline.json')); } catch {}
}

function testSaveBaseline() {
  cleanup();
  const result = runCliRaw(['audit-summary', '--cwd', tempDir, '--save', baselineFile, '--json', '--quiet'], { cwd: tempDir });
  assertOk(result, 'save baseline should succeed');
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
  // 1. JSON mode
  const result = runCliRaw(['audit-summary', '--cwd', tempDir, '--check-regression', '--json', '--quiet'], { cwd: tempDir });
  assert.strictEqual(result.status, 2, `Exit code should be 2 (validation/path error), got ${result.status}. stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, false, 'should fail when no baseline exists');
  assert(data.error.includes('Baseline file not found'), 'should report missing baseline');

  // 2. Human mode
  const resultHuman = runCliRaw(['audit-summary', '--cwd', tempDir, '--check-regression', '--quiet'], { cwd: tempDir });
  assert.strictEqual(resultHuman.status, 2, `Human mode should exit 2, got ${resultHuman.status}`);
  assert(resultHuman.stderr.includes('Baseline file not found'), 'should report Baseline file not found in stderr');
}

function testCheckRegressionWithBaseline() {
  cleanup();
  // First save a baseline
  const saveResult = runCliRaw(['audit-summary', '--cwd', tempDir, '--save', baselineFile, '--json', '--quiet'], { cwd: tempDir });
  assertOk(saveResult, 'save baseline should succeed');

  // Then check regression against it
  const result = runCliRaw(['audit-summary', '--cwd', tempDir, '--check-regression', '--baseline', baselineFile, '--json', '--quiet'], { cwd: tempDir });
  assertOk(result, 'check regression should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true, 'regression check should succeed');
  assert(data.regression.deadExports, 'should have regression breakdown');
  assert(Array.isArray(data.regression.deadExports.open), 'deadExports.open should be array');
  assert(Array.isArray(data.regression.deadExports.new), 'deadExports.new should be array');
  assert(Array.isArray(data.regression.deadExports.fixed), 'deadExports.fixed should be array');
  assert.strictEqual(data.regression.deadExports.new.length, 0, 'no new dead exports against same baseline');
  assert.strictEqual(data.regression.deadExports.fixed.length, 0, 'no fixed dead exports against same baseline');
}

function testSaveAndCheckRegressionDefaultPath() {
  cleanup();
  const saveResult = runCliRaw(['audit-summary', '--cwd', tempDir, '--save', '--json', '--quiet'], { cwd: tempDir });
  assertOk(saveResult, 'save baseline should succeed');

  const result = runCliRaw(['audit-summary', '--cwd', tempDir, '--check-regression', '--json', '--quiet'], { cwd: tempDir });
  assertOk(result, 'check regression should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true);
  assert.strictEqual(data.regression.baselinePath, path.join(tempDir, '.workspace-bridge-baseline.json'));
}

function testCheckRegressionAgainstCommit() {
  cleanup();
  const result = runCliRaw(['audit-summary', '--cwd', tempDir, '--check-regression', '--baseline', 'HEAD~1', '--json', '--quiet'], { cwd: tempDir });
  assertOk(result, 'check regression against commit should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.regression.ok, true, 'commit baseline check should succeed');
  assert.strictEqual(data.regression.commit, 'HEAD~1', 'should report commit');
  assert(data.regression.deadExports, 'should have regression breakdown');
  assert(Array.isArray(data.regression.deadExports.new), 'deadExports.new should be array');
  assert(Array.isArray(data.regression.deadExports.legacy), 'deadExports.legacy should be array');
  assert(Array.isArray(data.regression.unresolved.new), 'unresolved.new should be array');
  assert(Array.isArray(data.regression.cycles.new), 'cycles.new should be array');
}

function main() {
  try {
    testSaveBaseline();
    testCheckRegressionNoBaseline();
    testCheckRegressionWithBaseline();
    testSaveAndCheckRegressionDefaultPath();
    testCheckRegressionAgainstCommit();
  } finally {
    cleanup();
    cleanupTempDir(tempDir);
  }
}

main();
