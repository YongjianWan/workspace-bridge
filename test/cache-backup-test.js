#!/usr/bin/env node
/**
 * SQLite persistence reliability tests for WorkspaceCache.
 * Replaces old JSON backup tests (SQLite WAL + transactions provide
 * equivalent durability without manual .bak files).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');

async function testSaveAndLoadRoundtrip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cacheDir = path.join(root, '.cache');
  const cache = new WorkspaceCache(root, { cacheDir });
  const file = path.join(root, 'src', 'a.js');
  cache.setWorkspaceInfo({ profile: 'node' });
  cache.setFileMetadata(file, { mtime: 123, size: 9 });
  cache.setParseResult(file, {
    imports: [], exports: ['x'], importRecords: [], exportRecords: [], functionRecords: [], parseMode: 'ast', confidence: 'high', mtime: 123,
  });

  await cache.save();

  // Verify db file exists under tmpdir, not project root
  const dbPath = path.join(cache.cacheDir, 'cache.db');
  assert(fs.existsSync(dbPath), 'cache.db should exist in tmpdir');
  assert(!fs.existsSync(path.join(root, '.workspace-bridge-cache.json')), 'old json cache should not exist in project root');

  // New instance should load successfully
  const loaded = new WorkspaceCache(root, { cacheDir });
  const ok = loaded.load();
  assert.strictEqual(ok, true, 'should load from SQLite');
  assert(loaded.getFileMetadata(file), 'metadata should be recovered');
  assert(loaded.getParseResult(file), 'parse result should be recovered');

  cache.close();
  loaded.close();
  fs.rmSync(root, { recursive: true, force: true });
}

async function testLoadFailsWhenDatabaseMissing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cacheDir = path.join(root, '.cache');
  const loaded = new WorkspaceCache(root, { cacheDir });
  const ok = loaded.load();
  assert.strictEqual(ok, false, 'should fail when no database exists');
  loaded.close();
  fs.rmSync(root, { recursive: true, force: true });
}

async function testLoadFailsGracefullyWhenDatabaseCorrupted() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cacheDir = path.join(root, '.cache');
  const cache = new WorkspaceCache(root, { cacheDir });
  cache.setFileMetadata(path.join(root, 'a.js'), { mtime: 1, size: 1 });
  await cache.save();
  cache.close(); // ensure WAL is merged before we corrupt

  // Corrupt the SQLite file by overwriting first bytes
  const dbPath = path.join(cache.cacheDir, 'cache.db');
  fs.writeFileSync(dbPath, 'NOT_SQLITE', 'utf8');

  const loaded = new WorkspaceCache(root, { cacheDir });
  const ok = loaded.load();
  assert.strictEqual(ok, false, 'should fail gracefully when database is corrupted');
  cache.close();
  loaded.close();
  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await testSaveAndLoadRoundtrip();
  await testLoadFailsWhenDatabaseMissing();
  await testLoadFailsGracefullyWhenDatabaseCorrupted();
  console.log('cache-backup-test: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
