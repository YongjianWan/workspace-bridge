#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');

function testNormalizeFileMapEntriesDeterministic() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  const target = path.join(root, 'src', 'a.js');

  const rows = [
    [target, { mtime: 100, size: 1 }],
    [target, { mtime: 100, size: 2 }],
    [target, { mtime: 90, size: 3 }],
    [target, { mtime: 101, size: 4 }],
  ];
  const normalized = cache.normalizeFileMapEntries(rows);
  const picked = normalized.get(cache.normalizeFilePath(target));
  assert(picked, 'normalized row should exist');
  assert.strictEqual(picked.size, 4, 'newer mtime should replace older');

  const rowsTieOnly = [
    [target, { mtime: 200, size: 11 }],
    [target, { mtime: 200, size: 22 }],
  ];
  const tieNormalized = cache.normalizeFileMapEntries(rowsTieOnly);
  const tiePicked = tieNormalized.get(cache.normalizeFilePath(target));
  assert(tiePicked, 'tie row should exist');
  assert.strictEqual(tiePicked.size, 11, 'equal mtime should keep first entry deterministically');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testAtomicSaveCleanupOnRenameFailure() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  cache.setWorkspaceInfo({ kind: 'test' });
  cache.setFileMetadata(path.join(root, 'x.js'), { mtime: 1, size: 1 });

  const originalRenameSync = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('forced rename failure');
  };

  try {
    const ok = await cache.save();
    assert.strictEqual(ok, false, 'save should fail when rename fails');
    const leftovers = fs.readdirSync(root).filter((name) => name.includes('.workspace-bridge-cache.json.tmp-'));
    assert.strictEqual(leftovers.length, 0, 'temporary cache files should be cleaned up');
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testSaveAndLoadRoundtrip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(root);
  const file = path.join(root, 'src', 'b.js');
  cache.setWorkspaceInfo({ profile: 'node' });
  cache.setFileMetadata(file, { mtime: 123, size: 9, symbols: ['run'] });
  cache.setSymbols('run', [{ file, line: 1, type: 'function' }]);
  cache.setDiagnostics(file, { mtime: 123, diagnostics: [] });

  const saved = await cache.save();
  assert.strictEqual(saved, true, 'save should succeed');
  const loaded = new WorkspaceCache(root);
  const ok = await loaded.load();
  assert.strictEqual(ok, true, 'load should succeed');
  assert(loaded.getWorkspaceInfo(), 'workspace info should load');
  assert(loaded.getFileMetadata(file), 'file metadata should load');
  assert(Array.isArray(loaded.getSymbols('run')), 'symbols should load');

  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  testNormalizeFileMapEntriesDeterministic();
  await testAtomicSaveCleanupOnRenameFailure();
  await testSaveAndLoadRoundtrip();
  console.log('cache-test: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

