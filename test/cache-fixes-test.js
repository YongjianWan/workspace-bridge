#!/usr/bin/env node
// @semantic
/**
 * Targeted regression tests for cache.js data-consistency and cross-platform fixes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WorkspaceCache, computeDefaultCacheDir } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function testResolveCachedFilePathFallbackReturnsOriginalPath() {
  const dir = makeTempDir('wb-cache-fallback-');
  const file = path.join(dir, 'deleted.js');
  fs.writeFileSync(file, 'export const x = 1;\n');
  const stats = fs.statSync(file);

  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });

  fs.unlinkSync(file);

  const changes = cache.checkFileChanges();
  assert.strictEqual(changes.changed, true, 'should report changed for deleted file');
  assert.ok(changes.changedFiles.includes(file), 'changedFiles should include the original platform-native path, not a normalized key');

  cleanupTempDir(dir);
}

function testMtimeFastPathToleratesIntegerStoragePrecision() {
  const dir = makeTempDir('wb-cache-mtime-');
  const file = path.join(dir, 'integer-mtime.js');
  const content = 'const x = 1;\n';
  fs.writeFileSync(file, content);
  const stats = fs.statSync(file);

  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  // Simulate INTEGER-truncated mtime as it comes back from SQLite
  cache.setFileMetadata(file, {
    mtime: Math.floor(stats.mtimeMs),
    size: stats.size,
    hash: sha256(content),
  });

  const changes = cache.checkFileChanges();
  assert.strictEqual(changes.changed, false, 'should not flag unchanged file when stored mtime is integer-truncated');
  assert.deepStrictEqual(changes.changedFiles, [], 'changedFiles should be empty');

  cleanupTempDir(dir);
}

async function testMtimePrecisionSurvivesSaveLoadRoundtrip() {
  const dir = makeTempDir('wb-cache-mtime-roundtrip-');
  const file = path.join(dir, 'survives.js');
  const content = 'const y = 2;\n';
  fs.writeFileSync(file, content);
  const stats = fs.statSync(file);

  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size, hash: sha256(content) });
  assert.strictEqual(await cache.save(), true, 'save should succeed');
  cache.close();

  const loaded = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  assert.strictEqual(loaded.load(), true, 'load should succeed');
  const changes = loaded.checkFileChanges();
  assert.strictEqual(changes.changed, false, 'should not flag unchanged file after save/load roundtrip');
  loaded.close();

  cleanupTempDir(dir);
}

function testContentChangeWithRestoredMtime() {
  const dir = makeTempDir('wb-cache-restored-mtime-');
  const file = path.join(dir, 'main.js');
  const oldContent = 'import "./a.js";\n';
  const newContent = 'import "./b.js";\n';
  const fixedTime = new Date('2020-01-01T00:00:00Z');
  try {
    fs.writeFileSync(file, oldContent);
    fs.utimesSync(file, fixedTime, fixedTime);
    const stat = fs.statSync(file);
    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: stat.mtimeMs, size: stat.size, hash: sha256(oldContent) });

    fs.writeFileSync(file, newContent);
    fs.utimesSync(file, fixedTime, fixedTime);
    const changes = cache.checkFileChanges();
    assert(changes.changedFiles.includes(file), 'content change must survive equal size and restored mtime');
    cache.close();
  } finally {
    cleanupTempDir(dir);
  }
}

function testWalFilesMigrateWithCacheDb() {
  const root = makeTempDir('wb-cache-wal-migrate-');
  const legacyDir = path.join(root, '.workspace-bridge');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'cache.db'), 'main_db');
  fs.writeFileSync(path.join(legacyDir, 'cache.db-wal'), 'wal_data');
  fs.writeFileSync(path.join(legacyDir, 'cache.db-shm'), 'shm_data');

  const preferredDir = computeDefaultCacheDir(root);
  assert(!preferredDir.startsWith(root + path.sep), 'default cache must live outside the workspace');
  assert.strictEqual(fs.readFileSync(path.join(preferredDir, 'cache.db'), 'utf8'), 'main_db');
  assert.strictEqual(fs.readFileSync(path.join(preferredDir, 'cache.db-wal'), 'utf8'), 'wal_data');
  assert.strictEqual(fs.readFileSync(path.join(preferredDir, 'cache.db-shm'), 'utf8'), 'shm_data');
  assert(!fs.existsSync(legacyDir), 'migrated cache directory should no longer dirty the workspace');

  for (const suffix of ['', '-wal', '-shm']) fs.unlinkSync(path.join(preferredDir, 'cache.db' + suffix));
  fs.rmdirSync(preferredDir);
  cleanupTempDir(root);
}

function testDeleteFileMetadataCascadesToAllSlots() {
  const dir = makeTempDir('wb-cache-cascade-');
  const file = path.join(dir, 'src', 'cascade.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export const foo = 1;\n');

  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  const hash = sha256(fs.readFileSync(file, 'utf8'));
  cache.setFileMetadata(file, { mtime: 1, size: 1, hash });
  cache.setParseResult(file, {
    imports: [],
    exports: ['foo'],
    importRecords: [],
    exportRecords: [{ name: 'foo', kind: 'function' }],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    mtime: 1,
  });
  cache.setDiagnostics(file, { diagnostics: [{ message: 'demo' }] });
  cache.setSymbols('foo', [{ file, line: 1, type: 'function' }]);
  cache.setSymbols('bar', [{ file: path.join(dir, 'src', 'other.js'), line: 2, type: 'function' }]);

  assert.strictEqual(cache.hasFileMetadata(file), true, 'pre: fileMetadata should exist');
  assert.strictEqual(cache.hasParseResult(file), true, 'pre: parseResult should exist');
  assert.strictEqual(cache.getDiagnostics(file).length, 1, 'pre: diagnostics should exist');
  assert.strictEqual(cache.getSymbols('foo').length, 1, 'pre: symbol location should exist');
  assert.ok(cache.parsedHashes.has(cache.normalizeFilePath(file)), 'pre: parsedHashes should be tracked');

  cache.deleteFileMetadata(file);

  assert.strictEqual(cache.hasFileMetadata(file), false, 'post: fileMetadata should be removed');
  assert.strictEqual(cache.hasParseResult(file), false, 'post: parseResult should be cascaded-removed');
  assert.strictEqual(cache.getDiagnostics(file).length, 0, 'post: diagnostics should be cascaded-removed');
  assert.strictEqual(cache.getSymbols('foo').length, 0, 'post: symbol locations for file should be removed');
  assert.strictEqual(cache.getSymbols('bar').length, 1, 'post: symbol locations for other files should remain');
  assert.strictEqual(cache.parsedHashes.has(cache.normalizeFilePath(file)), false, 'post: parsedHashes should be cascaded-removed');

  cleanupTempDir(dir);
}

function testCloseIsExceptionSafe() {
  const dir = makeTempDir('wb-cache-close-');
  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });

  // Simulate a GraphDB close that throws (e.g., double-close race or corruption).
  cache._graphDb.close = function () {
    throw new Error('simulated close failure');
  };

  assert.doesNotThrow(() => cache.close(), 'close() should swallow GraphDB close errors');

  cleanupTempDir(dir);
}

async function main() {
  testResolveCachedFilePathFallbackReturnsOriginalPath();
  testMtimeFastPathToleratesIntegerStoragePrecision();
  testContentChangeWithRestoredMtime();
  await testMtimePrecisionSurvivesSaveLoadRoundtrip();
  testWalFilesMigrateWithCacheDb();
  testDeleteFileMetadataCascadesToAllSlots();
  testCloseIsExceptionSafe();
}

main().catch((err) => {
  console.error('cache-fixes-test failed:', err);
  process.exit(1);
});
