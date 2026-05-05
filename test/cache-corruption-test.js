#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');

function testLoadIgnoresCorruptedJson() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  fs.writeFileSync(path.join(dir, '.workspace-bridge-cache.json'), 'not-json{{', 'utf8');

  const cache = new WorkspaceCache(dir);
  const ok = cache.load();
  assert.strictEqual(ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testLoadIgnoresWrongVersion() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  fs.writeFileSync(
    path.join(dir, '.workspace-bridge-cache.json'),
    JSON.stringify({ version: 999, timestamp: Date.now() }),
    'utf8'
  );

  const cache = new WorkspaceCache(dir);
  const ok = cache.load();
  assert.strictEqual(ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testLoadIgnoresStaleCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(path.join(dir, 'a.js'), { mtime: 1, size: 1 });
  await cache.save();

  // Manually back-date the file to simulate stale cache
  const cachePath = path.join(dir, '.workspace-bridge-cache.json');
  const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
  fs.utimesSync(cachePath, oldTime, oldTime);

  const cache2 = new WorkspaceCache(dir);
  const ok = cache2.load();
  assert.strictEqual(ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testNormalizeFileMapEntriesHandlesNonArray() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(dir);

  // Passing a plain object should not crash; should treat as empty
  const result = cache.normalizeFileMapEntries({ foo: 'bar' });
  assert.strictEqual(result.size, 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testNormalizeDiagnosticsEntriesHandlesNonArray() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(dir);

  const result = cache.normalizeDiagnosticsEntries({ foo: 'bar' });
  assert.strictEqual(result.size, 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testSaveReturnsFalseOnPersistentFailure() {
  // Skip on Windows: chmod has no effect on file write permissions
  if (process.platform === 'win32') {
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-'));
  const cache = new WorkspaceCache(dir);
  cache.setWorkspaceInfo({ kind: 'test' });

  // Poison the directory so write fails
  fs.writeFileSync(path.join(dir, '.workspace-bridge-cache.json'), '', 'utf8');
  fs.chmodSync(dir, 0o555);

  try {
    const ok = await cache.save();
    assert.strictEqual(ok, false);
  } finally {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  testLoadIgnoresCorruptedJson();
  testLoadIgnoresWrongVersion();
  await testLoadIgnoresStaleCache();
  testNormalizeFileMapEntriesHandlesNonArray();
  testNormalizeDiagnosticsEntriesHandlesNonArray();
  await testSaveReturnsFalseOnPersistentFailure();
  console.log('cache-corruption-test: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
