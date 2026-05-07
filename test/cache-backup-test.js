#!/usr/bin/env node
/**
 * Regression test for #48: cache corruption silent drop (no backup).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');

async function testSaveCreatesBackup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  cache.setFileMetadata(path.join(root, 'a.js'), { mtime: 1, size: 1 });

  // First save: no prior cache file, so no backup is created yet.
  await cache.save();
  assert(fs.existsSync(path.join(root, '.workspace-bridge-cache.json')), 'main cache should exist');
  assert(!fs.existsSync(path.join(root, '.workspace-bridge-cache.json.bak')), 'no backup on first save');

  // Second save: overwrites existing cache, backup should be created.
  cache.setFileMetadata(path.join(root, 'b.js'), { mtime: 2, size: 2 });
  await cache.save();
  assert(fs.existsSync(path.join(root, '.workspace-bridge-cache.json.bak')), 'backup should exist after overwrite');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testLoadFallsBackToBackupOnCorruption() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  const file = path.join(root, 'a.js');
  cache.setFileMetadata(file, { mtime: 123, size: 9 });
  cache.setParseResult(file, {
    imports: [], exports: ['x'], importRecords: [], exportRecords: [], functionRecords: [], parseMode: 'ast', confidence: 'high', mtime: 123,
  });

  await cache.save();

  // Ensure a backup exists for the fallback test.
  fs.copyFileSync(
    path.join(root, '.workspace-bridge-cache.json'),
    path.join(root, '.workspace-bridge-cache.json.bak'),
  );

  // Corrupt the main cache file
  fs.writeFileSync(path.join(root, '.workspace-bridge-cache.json'), 'not-json', 'utf8');

  const loaded = new WorkspaceCache(root);
  const ok = loaded.load();
  assert.strictEqual(ok, true, 'should load from backup when primary is corrupted');
  assert(loaded.getFileMetadata(file), 'metadata should be recovered from backup');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testLoadFailsGracefullyWhenBothCorrupted() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  cache.setFileMetadata(path.join(root, 'a.js'), { mtime: 1, size: 1 });

  await cache.save();

  // Corrupt both main and backup
  fs.writeFileSync(path.join(root, '.workspace-bridge-cache.json'), 'bad', 'utf8');
  fs.writeFileSync(path.join(root, '.workspace-bridge-cache.json.bak'), 'bad', 'utf8');

  const loaded = new WorkspaceCache(root);
  const ok = loaded.load();
  assert.strictEqual(ok, false, 'should fail when both primary and backup are corrupted');

  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await testSaveCreatesBackup();
  await testLoadFallsBackToBackupOnCorruption();
  await testLoadFailsGracefullyWhenBothCorrupted();
  console.log('cache-backup-test: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
