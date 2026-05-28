const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { saveBaseline, checkRegression, checkRegressionAgainstCommit, DEFAULT_BASELINE_FILE, resolveBaseline } = require('../src/tools/regression-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testExtractFindings() {
  const result = {
    schemaVersion: '1.2.0',
    workspaceRoot: '/test',
    deadExports: {
      deadExports: [{ file: 'a.js', name: 'unused', confidence: 'high' }],
    },
    unresolved: {
      unresolved: [{ file: 'b.js', source: './missing', resolvedTo: null }],
    },
    cycles: {
      cycles: [{ files: ['c.js', 'd.js'], length: 2 }],
    },
    health: {
      checks: {
        readme: { found: true },
        license: { found: false },
      },
    },
  };

  const baseline = saveBaseline(result, path.join(makeTempDir('wb-reg-'), 'baseline.json'));
  assert.strictEqual(baseline.ok, true, 'saveBaseline should succeed');
  cleanupTempDir(path.dirname(baseline.filePath));
}

function testCheckRegressionFixedAndNew() {
  const tmpDir = makeTempDir('wb-reg-');
  const baselinePath = path.join(tmpDir, 'baseline.json');

  const previous = {
    schemaVersion: '1.2.0',
    workspaceRoot: '/test',
    deadExports: { deadExports: [{ file: 'a.js', name: 'oldFn', confidence: 'high' }] },
    unresolved: { unresolved: [] },
    cycles: { cycles: [] },
    health: { checks: {} },
  };
  saveBaseline(previous, baselinePath);

  const current = {
    schemaVersion: '1.2.0',
    workspaceRoot: '/test',
    deadExports: { deadExports: [{ file: 'a.js', name: 'newFn', confidence: 'medium' }] },
    unresolved: { unresolved: [] },
    cycles: { cycles: [] },
    health: { checks: {} },
  };

  const regression = checkRegression(current, baselinePath);
  assert.strictEqual(regression.ok, true, 'checkRegression should succeed');
  assert.strictEqual(regression.regression.deadExports.fixed.length, 1, 'oldFn should be fixed');
  assert.strictEqual(regression.regression.deadExports.new.length, 1, 'newFn should be new');
  assert.strictEqual(regression.regression.deadExports.open.length, 0, 'nothing should be open');

  cleanupTempDir(tmpDir);
}

function testCheckRegressionInvalidBaseline() {
  const tmpDir = makeTempDir('wb-reg-');
  const badPath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badPath, 'not json', 'utf8');

  const regression = checkRegression({}, badPath);
  assert.strictEqual(regression.ok, false, 'should fail on invalid baseline');
  assert(regression.error.includes('Failed to load'), 'error should mention load failure');

  cleanupTempDir(tmpDir);
}

function testCheckRegressionMissingFindings() {
  const tmpDir = makeTempDir('wb-reg-');
  const badPath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ schemaVersion: '1.0.0' }), 'utf8');

  const regression = checkRegression({}, badPath);
  assert.strictEqual(regression.ok, false, 'should fail on missing findings');
  assert(regression.error.includes('missing findings'), 'error should mention missing findings');

  cleanupTempDir(tmpDir);
}

function testDefaultBaselineFile() {
  assert.strictEqual(typeof DEFAULT_BASELINE_FILE, 'string', 'DEFAULT_BASELINE_FILE should be a string');
  assert(DEFAULT_BASELINE_FILE.endsWith('.json'), 'DEFAULT_BASELINE_FILE should end with .json');
}

function testResolveBaselineRejectsInjection() {
  // execFileSync uses argument arrays — injection payloads are treated as literal args
  try {
    resolveBaseline({ baseline: 'HEAD; echo pwned', cwd: process.cwd() });
    assert.fail('should have thrown');
  } catch (e) {
    assert(
      e.message.includes('Baseline file not found') || e.message.includes('not a git repository'),
      'should reject injection safely without executing shell commands'
    );
  }
}

function testCheckRegressionAgainstCommitRejectsInjection() {
  const current = {
    schemaVersion: '1.2.0',
    workspaceRoot: '/test',
    deadExports: { deadExports: [] },
    unresolved: { unresolved: [] },
    cycles: { cycles: [] },
    health: { checks: {} },
  };
  const result = checkRegressionAgainstCommit(current, 'HEAD; echo pwned', process.cwd());
  assert.strictEqual(result.ok, false, 'should fail safely on injection attempt');
  assert(result.error.includes('Invalid commit'), 'error should be a validation error, not a shell error');
}

function main() {
  testExtractFindings();
  testCheckRegressionFixedAndNew();
  testCheckRegressionInvalidBaseline();
  testCheckRegressionMissingFindings();
  testDefaultBaselineFile();
  testResolveBaselineRejectsInjection();
  testCheckRegressionAgainstCommitRejectsInjection();
}

main();
