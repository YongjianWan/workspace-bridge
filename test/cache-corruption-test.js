#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testLoadIgnoresMissingDatabase() {
  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });
  const ok = cache.load();
  assert.strictEqual(ok, false);
  cache.close();
  cleanupTempDir(dir);
}

function testLoadIgnoresWrongVersion() {
  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });
  cache.setFileMetadata(path.join(dir, 'a.js'), { mtime: 1, size: 1 });
  cache.save();

  // Tamper with version in SQLite directly
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(cache.cacheDir, 'cache.db'));
  db.prepare('UPDATE cache_metadata SET value = ? WHERE key = ?').run('999', 'version');
  db.close();

  const cache2 = new WorkspaceCache(dir, { cacheDir });
  const ok = cache2.load();
  assert.strictEqual(ok, false);
  cache.close();
  cache2.close();
  cleanupTempDir(dir);
}

async function testLoadIgnoresStaleCache() {
  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });
  cache.setFileMetadata(path.join(dir, 'a.js'), { mtime: 1, size: 1 });
  await cache.save();

  // Manually back-date the db file to simulate stale cache
  const dbPath = path.join(cache.cacheDir, 'cache.db');
  const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
  fs.utimesSync(dbPath, oldTime, oldTime);

  const cache2 = new WorkspaceCache(dir, { cacheDir });
  const ok = cache2.load();
  assert.strictEqual(ok, false);
  cache.close();
  cache2.close();
  cleanupTempDir(dir);
}

function testNormalizeFileMapEntriesHandlesNonArray() {
  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });

  // Passing a plain object should not crash; should treat as empty
  const result = cache.normalizeFileMapEntries({ foo: 'bar' });
  assert.strictEqual(result.size, 0);
  cache.close();
  cleanupTempDir(dir);
}

function testNormalizeDiagnosticsEntriesHandlesNonArray() {
  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });

  const result = cache.normalizeDiagnosticsEntries({ foo: 'bar' });
  assert.strictEqual(result.size, 0);
  cache.close();
  cleanupTempDir(dir);
}

async function testSaveReturnsFalseOnPersistentFailure() {
  // Skip on Windows: chmod has no effect on file write permissions
  if (process.platform === 'win32') {
    return;
  }

  const dir = makeTempDir('wb-cache-');
  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });
  cache.setWorkspaceInfo({ kind: 'test' });

  // Pre-create the db directory and make it read-only
  fs.mkdirSync(cache.cacheDir, { recursive: true });
  fs.chmodSync(cache.cacheDir, 0o555);

  try {
    const ok = await cache.save();
    assert.strictEqual(ok, false);
  } finally {
    fs.chmodSync(cache.cacheDir, 0o755);
    cache.close();
    cleanupTempDir(dir);
  }
}

async function main() {
  testLoadIgnoresMissingDatabase();
  testLoadIgnoresWrongVersion();
  await testLoadIgnoresStaleCache();
  testNormalizeFileMapEntriesHandlesNonArray();
  testNormalizeDiagnosticsEntriesHandlesNonArray();
  await testSaveReturnsFalseOnPersistentFailure();
}

main().catch((e) => { console.error(e); process.exit(1); });
