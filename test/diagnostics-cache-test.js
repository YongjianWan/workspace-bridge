#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorkspaceCache } = require('../src/services/cache');
const { runDiagnostics } = require('../src/tools/workspace-tools');

async function testDiagnosticsCacheReturnsData() {
  const container = {
    workspaceRoot: process.cwd(),
    cache: {
      getWorkspaceInfo() { return { root: process.cwd() }; },
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
  const container = {
    workspaceRoot: tmpDir,
    cache: {
      getWorkspaceInfo() { return { root: tmpDir }; },
      getAllDiagnostics() { return []; },
    },
  };

  const result = await runDiagnostics({ cwd: tmpDir, mode: 'quick' }, container);
  assert(!result.cached, 'should not mark cached when no diagnostics in cache');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testCacheDiagnosticsStructure() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-diag-'));
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

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  testCacheDiagnosticsStructure();
  await testDiagnosticsCacheReturnsData();
  await testDiagnosticsCacheEmptyFallsThrough();
  console.log('diagnostics-cache-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
