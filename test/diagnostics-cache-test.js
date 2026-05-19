#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { runDiagnostics } = require('../src/tools/workspace-tools');

async function testDiagnosticsCacheReturnsData() {
  const container = {
    workspaceRoot: process.cwd(),
    cache: {
      getWorkspaceInfo() { return { root: process.cwd() }; },
      hasDiagnosticEntries() { return true; },
      getAllDiagnostics() {
        return [
          { file: 'src/a.js', line: 1, message: 'Error', severity: 'error', source: 'test' },
          { file: 'src/b.js', line: 2, message: 'Warning', severity: 'warning', source: 'test' },
        ];
      },
    },
  };

  const result = await runDiagnostics({ cwd: process.cwd() }, container);
  assert.strictEqual(result.cached, true, 'should mark as cached');
  assert.strictEqual(result.diagnostics.length, 2, 'should return cached diagnostics');
  assert.strictEqual(result.diagnosticsSummary.total, 2, 'should compute summary from cached data');
  assert.strictEqual(result.diagnosticsSummary.error, 1, 'should count error severity');
  assert.strictEqual(result.diagnosticsSummary.warning, 1, 'should count warning severity');
}

async function testDiagnosticsCacheEmptyFallsThrough() {
  const tmpDir = makeTempDir('wb-diag-miss-');
  const cache = new WorkspaceCache(tmpDir);
  cache.setWorkspaceInfo({ root: tmpDir });
  // Intentionally NOT calling cache.setDiagnostics — simulates "never run diagnostics"

  const container = {
    workspaceRoot: tmpDir,
    cache,
  };

  const result = await runDiagnostics({ cwd: tmpDir, mode: 'quick' }, container);
  assert(!result.cached, 'should not mark cached when no diagnostic entries exist in cache');

  cleanupTempDir(tmpDir);
}

async function testDiagnosticsCacheEmptyHits() {
  const tmpDir = makeTempDir('wb-diag-hit-');
  const cache = new WorkspaceCache(tmpDir);
  cache.setWorkspaceInfo({ root: tmpDir });
  // Simulate: linter ran on one file with 0 problems
  const file = path.join(tmpDir, 'a.js');
  cache.setDiagnostics(file, { mtime: 1, diagnostics: [] });

  const container = {
    workspaceRoot: tmpDir,
    cache,
  };

  const result = await runDiagnostics({ cwd: tmpDir, mode: 'quick' }, container);
  assert.strictEqual(result.cached, true, 'should cache-hit when diagnostic entries exist even if arrays are empty');
  assert.strictEqual(result.diagnostics.length, 0, 'should return empty diagnostics');
  assert.deepStrictEqual(result.diagnosticsSummary, { total: 0, error: 0, warning: 0, information: 0, hint: 0 });

  cleanupTempDir(tmpDir);
}

function testCacheDiagnosticsStructure() {
  const tmpDir = makeTempDir('wb-cache-diag-');
  const cache = new WorkspaceCache(tmpDir);
  const file = path.join(tmpDir, 'a.js');
  cache.setDiagnostics(file, { mtime: 1, diagnostics: [{ file: 'a.js', line: 1, message: 'err', severity: 'error' }] });

  const all = cache.getAllDiagnostics();
  assert.strictEqual(all.length, 1, 'getAllDiagnostics should extract diagnostics from { mtime, diagnostics } structure');
  assert.strictEqual(all[0].message, 'err', 'should preserve diagnostic content');

  const single = cache.getDiagnostics(file);
  assert(Array.isArray(single), 'getDiagnostics should return array');
  assert.strictEqual(single.length, 1, 'getDiagnostics should return diagnostics array, not wrapper object');
  assert.strictEqual(single[0].message, 'err', 'should preserve diagnostic content');

  cleanupTempDir(tmpDir);
}

function testHasDiagnosticEntries() {
  const tmpDir = makeTempDir('wb-has-diag-');
  const cache = new WorkspaceCache(tmpDir);
  assert.strictEqual(cache.hasDiagnosticEntries(), false, 'should be false when no entries');

  const file = path.join(tmpDir, 'a.js');
  cache.setDiagnostics(file, { mtime: 1, diagnostics: [] });
  assert.strictEqual(cache.hasDiagnosticEntries(), true, 'should be true when entry exists even if empty array');

  cache.clearDiagnostics(file);
  assert.strictEqual(cache.hasDiagnosticEntries(), false, 'should be false after clear');

  cleanupTempDir(tmpDir);
}

async function main() {
  testCacheDiagnosticsStructure();
  testHasDiagnosticEntries();
  await testDiagnosticsCacheReturnsData();
  await testDiagnosticsCacheEmptyFallsThrough();
  await testDiagnosticsCacheEmptyHits();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
