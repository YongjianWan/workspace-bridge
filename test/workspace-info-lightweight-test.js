#!/usr/bin/env node
// @contract — verifies workspace-info is a true lightweight preflight: fast, no full container init, stable schema fields.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCli, REPO_ROOT, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { workspaceInfo } = require('../src/tools/workspace-tools');

const LIGHTWEIGHT_BUDGET_MS = 2000;

function testWorkspaceInfoCliIsFast() {
  const start = Date.now();
  const info = runCli(['workspace-info', '--cwd', '.', '--json', '--quiet']);
  const elapsed = Date.now() - start;

  assert.strictEqual(info.ok, true, 'workspace-info should return ok');
  assert.strictEqual(info.workspaceRoot, REPO_ROOT, 'workspaceRoot should match repo root');
  assert(typeof info.fileCount === 'number' && info.fileCount > 0, 'fileCount should be a positive number');
  assert(info.detected && typeof info.detected === 'object', 'detected should be an object');
  assert(info.stack && typeof info.stack === 'object', 'stack should be an object');
  assert(Array.isArray(info.availableChecks), 'availableChecks should be an array');
  assert.strictEqual(info.schemaVersion, '1.2.0', 'schemaVersion should be frozen');
  assert(
    elapsed < LIGHTWEIGHT_BUDGET_MS,
    `workspace-info should complete in <${LIGHTWEIGHT_BUDGET_MS}ms, took ${elapsed}ms`
  );
}

function testWorkspaceInfoToolLightweightScan() {
  const tmpDir = makeTempDir('wb-wsinfo-light-');
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'light-test' }), 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'c.py'), 'c = 3\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'x.js'), 'module.exports = 1;\n', 'utf8');

    const info = workspaceInfo({ cwd: tmpDir }, null);

    assert.strictEqual(info.ok, true, 'workspaceInfo should return ok in lightweight mode');
    assert.strictEqual(info.workspaceRoot, tmpDir, 'workspaceRoot should match tmpDir');
    assert.strictEqual(info.fileCount, 3, 'fileCount should count source files, excluding node_modules');
    assert.strictEqual(info.languages.javascript, 1, 'should count .js as javascript');
    assert.strictEqual(info.languages.typescript, 1, 'should count .ts as typescript');
    assert.strictEqual(info.languages.python, 1, 'should count .py as python');
    assert.deepStrictEqual(info.entryFiles, [], 'entryFiles should be empty in lightweight mode');
    assert.strictEqual(info.totalLines, 0, 'totalLines should be 0 in lightweight mode');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

function testWorkspaceInfoNoContainerDoesNotLeakWarnings() {
  const tmpDir = makeTempDir('wb-wsinfo-nowarn-');
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'no-warn' }), 'utf8');
    const result = runCli(['workspace-info', '--cwd', tmpDir, '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(!Object.prototype.hasOwnProperty.call(result, 'warnings'), 'lightweight workspace-info should not include warnings field');
    assert(!Object.prototype.hasOwnProperty.call(result, 'staleness'), 'lightweight workspace-info should not include staleness field');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

function main() {
  testWorkspaceInfoCliIsFast();
  testWorkspaceInfoToolLightweightScan();
  testWorkspaceInfoNoContainerDoesNotLeakWarnings();
}

main();
