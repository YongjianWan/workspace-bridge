#!/usr/bin/env node
// @contract

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCli, runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

function testIgnorePathsExclusion() {
  const tempDir = makeTempDir('wb-test-ignore-paths-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'src1.js'), 'export function a() {}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'src2.js'), 'export function b() {}', 'utf8');

  // Create .workspace-bridge.json with ignore.paths
  fs.writeFileSync(
    path.join(tempDir, '.workspace-bridge.json'),
    JSON.stringify({
      ignore: {
        paths: ['src2.js']
      }
    }, null, 2),
    'utf8'
  );

  const cache = new WorkspaceCache(tempDir);
  cache.load();
  const index = new FileIndex(tempDir, cache);
  index._applyWorkspaceExcludeDirs();

  assert(index.shouldExclude(path.join(tempDir, 'src2.js')) === true, 'src2.js should be excluded');
  assert(index.shouldExclude(path.join(tempDir, 'src1.js')) === false, 'src1.js should not be excluded');

  cleanupTempDir(tempDir);
}

function testIgnoreFindingsSuppressionAndMarkFalsePositive() {
  const tempDir = makeTempDir('wb-test-ignore-findings-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'app.js'), 'const secret = "password=123456789"; eval(x);', 'utf8');

  // 1. Run security scan to discover findings and their IDs
  const scan1 = runCli(['audit-security', '--builtin-only', '--cwd', tempDir, '--json', '--quiet']);
  assert.strictEqual(scan1.ok, true);
  assert(Array.isArray(scan1.findings));
  assert(scan1.findings.length >= 2, 'Should find at least secret and eval');

  // Verify finding has ID and rule alias
  const finding = scan1.findings[0];
  assert(finding.id !== undefined, 'findings should have id');
  assert.strictEqual(finding.rule, finding.ruleId);

  // 2. Mark one finding as false positive via CLI using runCliRaw to debug
  const targetId = finding.id;
  const raw = runCliRaw(['--mark-false-positive', targetId, '--cwd', tempDir]);
  console.log('DEBUG: mark status =', raw.status);
  console.log('DEBUG: mark stdout =', raw.stdout);
  console.log('DEBUG: mark stderr =', raw.stderr);

  assert.strictEqual(raw.status, 0);
  assert(raw.stdout.includes('marked as false positive'), 'Should output success message');

  // Verify .workspace-bridge.json was updated
  const config = JSON.parse(fs.readFileSync(path.join(tempDir, '.workspace-bridge.json'), 'utf8'));
  assert(config.ignore?.findings?.includes(targetId), 'Config should contain the ignored finding ID');

  // 3. Re-run scan, verify the ignored finding is filtered out
  const scan2 = runCli(['audit-security', '--builtin-only', '--cwd', tempDir, '--json', '--quiet']);
  assert.strictEqual(scan2.ok, true);
  const matched = scan2.findings.find(f => f.id === targetId);
  assert(matched === undefined, 'Ignored finding should be filtered out');
  assert.strictEqual(scan2.findings.length, scan1.findings.length - 1, 'Should have exactly 1 less finding');

  cleanupTempDir(tempDir);
}

function testEnvVarsAndPrecedence() {
  const tempDir = makeTempDir('wb-test-env-vars-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'app.js'), 'eval(x);', 'utf8');

  // Set environment variable
  process.env.WB_FORMAT = 'json';

  // Run security scan (without --json, but format should be overridden to json by WB_FORMAT)
  const res = runCli(['audit-security', '--builtin-only', '--cwd', tempDir]);
  delete process.env.WB_FORMAT;

  // runCli already asserts exit code 0 and parses JSON stdout, so if it returns successfully,
  // it means the output was valid JSON.
  assert.strictEqual(res.ok, true, 'Output should be valid JSON response');

  cleanupTempDir(tempDir);
}

function main() {
  testIgnorePathsExclusion();
  testIgnoreFindingsSuppressionAndMarkFalsePositive();
  testEnvVarsAndPrecedence();
  console.log('All Wave 14 tests passed.');
}

main();
